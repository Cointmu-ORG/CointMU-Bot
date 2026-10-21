import { setTimeout as delay } from 'node:timers/promises';
import { KvKey, type KvRepo } from '../db/kv-repo.js';
import { describeError, type Logger } from '../logger.js';
import {
  ChatType,
  Priority,
  TelegramApiError,
  type CallbackQuery,
  type IncomingMessage,
  type TelegramApi,
} from '../telegram/types.js';
import type { AdminPicker } from './admin-picker.js';
import type { BotCommandsSync } from './bot-commands.js';
import type { CallbackRouter, Delivery } from './callbacks.js';
import { Admission, type ReplyGate } from './reply-gate.js';
import type { CommandRouter } from './router.js';
import { toMarkup, type Screen } from './screen.js';

const ERROR_BACKOFF_MS = 5_000;

export interface CommandPollerDeps {
  readonly telegram: TelegramApi;
  readonly kv: KvRepo;
  readonly router: CommandRouter;
  readonly callbacks: CallbackRouter;
  readonly picker: AdminPicker;
  readonly gate: ReplyGate;
  readonly commandsSync: BotCommandsSync;
  readonly log: Logger;
  readonly now: () => number;
}

/**
 * Long-polls getUpdates. Button presses are answered right away (answerCallbackQuery, outside
 * the send queue, all of a batch in parallel); replies are queued at REPLY priority and never
 * awaited here, so a busy queue cannot stall the poller.
 */
export class CommandPoller {
  private readonly abort = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: CommandPollerDeps) {}

  async tick(): Promise<void> {
    const { telegram, kv, log } = this.deps;
    const offset = Number(kv.get(KvKey.TELEGRAM_UPDATE_OFFSET) ?? 0);
    let updates;
    try {
      updates = await telegram.getUpdates(offset, this.abort.signal);
    } catch (error) {
      if (this.abort.signal.aborted) return;
      log.warn('getUpdates failed', { error: describeError(error) });
      await delay(ERROR_BACKOFF_MS);
      return;
    }
    const answers: Promise<void>[] = [];
    for (const update of updates) {
      // Advance first: an update whose handling keeps failing must not be replayed forever.
      kv.set(KvKey.TELEGRAM_UPDATE_OFFSET, String(update.updateId + 1), this.deps.now());
      if (update.callback) answers.push(this.handleCallback(update.callback));
      else if (update.message) this.handleMessage(update.message);
    }
    await Promise.all(answers);
    await this.deps.commandsSync.syncIfChanged();
  }

  /** Aborts the long poll in flight so shutdown does not wait for it. */
  stop(): void {
    this.abort.abort();
  }

  /** Resolves once every reply started so far has been sent (or failed). For tests. */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  private handleMessage(message: IncomingMessage): void {
    const now = this.deps.now();
    const pickerReply = this.deps.picker.handleShared(message, now);
    if (pickerReply) {
      this.reply(message, pickerReply, null, now);
      return;
    }
    const outcome = this.deps.router.handle(message, now);
    if (outcome.kind === 'reply') this.reply(message, outcome.screen, outcome.viewKey, now);
  }

  private reply(
    message: IncomingMessage,
    screen: Screen,
    viewKey: string | null,
    now: number,
  ): void {
    const isGroup = message.chatType !== ChatType.PRIVATE;
    const admission = this.deps.gate.admit({ chatId: message.chatId, isGroup, viewKey }, now);
    if (admission !== Admission.OK) {
      this.deps.log.debug('reply dropped', { chatId: message.chatId, admission });
      return;
    }
    this.track(this.deliver({ chatId: message.chatId, screen, editMessageId: null }));
  }

  private async handleCallback(callback: CallbackQuery): Promise<void> {
    const result = this.deps.callbacks.handle(callback, this.deps.now());
    // Queue the reply before awaiting the answer: enqueueing is synchronous, so the next press in
    // the same batch already sees it when the reply gate checks the queue size.
    if (result.delivery) this.track(this.deliver(result.delivery));
    try {
      await this.deps.telegram.answerCallback(callback.id, result.toast);
    } catch (error) {
      this.deps.log.warn('answerCallbackQuery failed', { error: describeError(error) });
    }
  }

  /** Edits when asked to, falling back to a new message if the old one cannot be edited. */
  private async deliver({ chatId, screen, editMessageId }: Delivery): Promise<void> {
    const options = { markup: toMarkup(screen), priority: Priority.REPLY };
    if (editMessageId !== null) {
      try {
        await this.deps.telegram.editMessage(chatId, editMessageId, screen.text, options);
        return;
      } catch (error) {
        if (!(error instanceof TelegramApiError && error.isMessageGone)) throw error;
      }
    }
    await this.deps.telegram.sendMessage(chatId, screen.text, options);
  }

  private track(delivery: Promise<void>): void {
    const tracked = delivery
      .catch((error: unknown) => {
        this.deps.log.warn('command reply failed', { error: describeError(error) });
      })
      .finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }
}
