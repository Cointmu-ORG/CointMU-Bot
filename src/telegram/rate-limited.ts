import { setTimeout as delay } from 'node:timers/promises';
import { describeError, type Logger } from '../logger.js';
import {
  Priority,
  TelegramApiError,
  type BotCommand,
  type CommandScope,
  type SendOptions,
  type TelegramApi,
  type TelegramUpdate,
} from './types.js';

const MAX_RATE_LIMIT_RETRIES = 5;
const MS_PER_SECOND = 1000;

export interface RateLimitOptions {
  /** Minimum gap between two sends/edits to the same chat. */
  readonly minGapMs: number;
  /** Most command replies allowed to wait in the queue; more are rejected, never queued. */
  readonly maxQueuedReplies: number;
  readonly log: Logger;
}

export class QueueFullError extends Error {
  override name = 'QueueFullError';
}

interface Job {
  readonly chatId: string;
  readonly priority: Priority;
  readonly seq: number;
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  attempts: number;
}

/**
 * One send queue with priorities (alert > digest/status edit > command reply), a per-chat gap,
 * and a global pause on HTTP 429 (a 429 means nothing was sent, so retrying cannot duplicate).
 * The worker always takes the most important job whose chat is out of its gap, so replies never
 * hold back alerts or digests by more than the one request already in flight.
 * answerCallback, setMyCommands and getUpdates bypass the queue.
 */
export class RateLimitedTelegram implements TelegramApi {
  private readonly jobs: Job[] = [];
  private readonly lastSentAt = new Map<string, number>();
  private readonly closing = new AbortController();
  private pausedUntil = 0;
  private seq = 0;
  private isDraining = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly api: TelegramApi,
    private readonly options: RateLimitOptions,
  ) {}

  sendMessage(chatId: string, html: string, options: SendOptions = {}): Promise<number> {
    return this.enqueue(chatId, options.priority, () =>
      this.api.sendMessage(chatId, html, options),
    );
  }

  editMessage(
    chatId: string,
    messageId: number,
    html: string,
    options: SendOptions = {},
  ): Promise<void> {
    return this.enqueue(chatId, options.priority, () =>
      this.api.editMessage(chatId, messageId, html, options),
    );
  }

  answerCallback(callbackId: string, text: string | null): Promise<void> {
    return this.api.answerCallback(callbackId, text);
  }

  setMyCommands(commands: readonly BotCommand[], scope: CommandScope): Promise<void> {
    return this.api.setMyCommands(commands, scope);
  }

  deleteMyCommands(scope: CommandScope): Promise<void> {
    return this.api.deleteMyCommands(scope);
  }

  getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.api.getUpdates(offset, signal);
  }

  queuedReplies(): number {
    return this.jobs.filter((job) => job.priority === Priority.REPLY).length;
  }

  /** Rejects everything still queued and stops waiting, so shutdown is never held up. */
  close(): void {
    this.closing.abort();
    for (const job of this.jobs.splice(0)) job.reject(new Error('telegram queue closed'));
  }

  private enqueue<T>(
    chatId: string,
    priority: Priority = Priority.DIGEST,
    run: () => Promise<T>,
  ): Promise<T> {
    if (this.closing.signal.aborted) return Promise.reject(new Error('telegram queue closed'));
    if (priority === Priority.REPLY && this.queuedReplies() >= this.options.maxQueuedReplies) {
      return Promise.reject(new QueueFullError('command reply queue is full'));
    }
    return new Promise<T>((resolve, reject) => {
      this.seq += 1;
      const job: Job = {
        chatId,
        priority,
        seq: this.seq,
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        attempts: 0,
      };
      this.jobs.push(job);
      this.wake?.();
      if (!this.isDraining) {
        this.drain().catch((error: unknown) => {
          this.options.log.error('telegram queue stopped', { error: describeError(error) });
        });
      }
    });
  }

  private async drain(): Promise<void> {
    this.isDraining = true;
    try {
      while (this.jobs.length > 0 && !this.closing.signal.aborted) {
        const job = this.takeReadyJob(Date.now());
        if (job) await this.execute(job);
        else await this.sleepUntilReady();
      }
    } finally {
      this.isDraining = false;
    }
  }

  private async execute(job: Job): Promise<void> {
    try {
      job.resolve(await job.run());
    } catch (error) {
      if (!this.shouldRetry(error, job)) {
        job.reject(error);
        return;
      }
      // Back in the queue with its original seq, so it keeps its place in line.
      this.jobs.push(job);
    } finally {
      this.lastSentAt.set(job.chatId, Date.now());
    }
  }

  private shouldRetry(error: unknown, job: Job): boolean {
    if (!(error instanceof TelegramApiError) || !error.isRateLimited) return false;
    if (job.attempts >= MAX_RATE_LIMIT_RETRIES) return false;
    job.attempts += 1;
    const waitMs = (error.retryAfterS ?? 1) * MS_PER_SECOND;
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + waitMs);
    this.options.log.warn('telegram rate limited, pausing queue', { method: error.method, waitMs });
    return true;
  }

  private readyAt(job: Job): number {
    const last = this.lastSentAt.get(job.chatId);
    const chatReadyAt = last === undefined ? 0 : last + this.options.minGapMs;
    return Math.max(chatReadyAt, this.pausedUntil);
  }

  /** Removes and returns the most important job that may run now (FIFO within a priority). */
  private takeReadyJob(now: number): Job | null {
    let best: Job | null = null;
    for (const job of this.jobs) {
      if (this.readyAt(job) > now) continue;
      if (
        !best ||
        job.priority < best.priority ||
        (job.priority === best.priority && job.seq < best.seq)
      ) {
        best = job;
      }
    }
    if (best) this.jobs.splice(this.jobs.indexOf(best), 1);
    return best;
  }

  /** Sleeps until the earliest job becomes ready, or until a new job arrives. */
  private async sleepUntilReady(): Promise<void> {
    const waitMs = Math.max(0, Math.min(...this.jobs.map((job) => this.readyAt(job))) - Date.now());
    const timer = new AbortController();
    const woken = new Promise<void>((resolve) => {
      this.wake = resolve;
    });
    const signal = AbortSignal.any([this.closing.signal, timer.signal]);
    try {
      await Promise.race([delay(waitMs, undefined, { signal }), woken]);
    } catch (error) {
      // Aborted by close() or by our own cleanup below; anything else is a real failure.
      if (!signal.aborted) throw error;
    } finally {
      this.wake = null;
      timer.abort();
    }
  }
}
