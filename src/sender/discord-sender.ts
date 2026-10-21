import Database from 'better-sqlite3';
import type { BlocksRepo } from '../db/blocks-repo.js';
import type { DiscordRepo } from '../db/discord-repo.js';
import { DiscordApiError, type DiscordEmbed, type DiscordWebhook } from '../discord/types.js';
import { describeError, type Logger } from '../logger.js';
import type { RenderSettings } from '../render/card.js';
import {
  embedLength,
  groupForDiscord,
  renderBlockEmbed,
  renderSkippedEmbed,
  toPayload,
} from '../render/discord.js';

/** More blocks than this waiting (e.g. after a long outage): older ones collapse into a summary. */
export const DISCORD_BACKLOG_MAX_BLOCKS = 100;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 300_000;
/** Log every Nth consecutive failure at warn level; the rest go to debug. */
const FAILURE_LOG_EVERY = 30;

export interface DiscordSenderDeps {
  readonly blocks: BlocksRepo;
  readonly discord: DiscordRepo;
  readonly webhook: DiscordWebhook;
  readonly settings: RenderSettings;
  readonly log: Logger;
  readonly now: () => number;
}

/**
 * Posts each block to Discord once it is final (CONFIRMATIONS), up to 10 embeds per message,
 * ascending. Runs in its own loop with its own `discord_sent` flag, so a Discord outage or
 * 429 never delays or repeats Telegram. A block is marked only after Discord accepted it.
 */
export class DiscordSender {
  private pausedUntil = 0;
  private failures = 0;

  constructor(private readonly deps: DiscordSenderDeps) {}

  async tick(): Promise<void> {
    if (this.isPaused()) return;
    const head = this.deps.blocks.getTip()?.number;
    if (head === undefined) return;
    const lastFinal = head - this.deps.settings.confirmations + 1;
    try {
      await this.collapseBacklog(lastFinal);
      await this.postPending(lastFinal);
      this.recordSuccess();
    } catch (error) {
      this.recordFailure(error);
    }
  }

  private isPaused(): boolean {
    return this.deps.now() < this.pausedUntil;
  }

  /** Posts a summary for everything older than the newest DISCORD_BACKLOG_MAX_BLOCKS, then skips it. */
  private async collapseBacklog(lastFinal: number): Promise<void> {
    const { discord, log } = this.deps;
    const pending = discord.countPending(lastFinal);
    if (!pending || pending.count <= DISCORD_BACKLOG_MAX_BLOCKS) return;
    const skipped = discord.countPending(pending.to - DISCORD_BACKLOG_MAX_BLOCKS);
    if (!skipped) return;
    await this.post([renderSkippedEmbed(skipped)]);
    discord.markSentUpTo(skipped.to, this.deps.now());
    log.warn('discord backlog collapsed into a summary', { ...skipped });
  }

  private async postPending(lastFinal: number): Promise<void> {
    const { discord, settings, log } = this.deps;
    const items = discord
      .listPending(lastFinal, DISCORD_BACKLOG_MAX_BLOCKS)
      .map((block) => ({ block, embed: renderBlockEmbed(block, settings) }));
    for (const group of groupForDiscord(items, (item) => embedLength(item.embed))) {
      // The previous post emptied the rate-limit bucket: continue on a later tick.
      if (this.isPaused()) return;
      await this.post(group.map((item) => item.embed));
      discord.markSent(
        group.map((item) => item.block.hash),
        this.deps.now(),
      );
      log.info('discord batch posted', {
        blocks: group.length,
        from: group[0]?.block.number,
        to: group.at(-1)?.block.number,
      });
    }
  }

  private async post(embeds: readonly DiscordEmbed[]): Promise<void> {
    const waitMs = await this.deps.webhook.execute(toPayload(embeds));
    if (waitMs > 0) this.pausedUntil = this.deps.now() + waitMs;
  }

  private recordSuccess(): void {
    if (this.failures > 0) this.deps.log.info('discord recovered', { failures: this.failures });
    this.failures = 0;
  }

  /** 429: wait exactly retry_after. Anything else: exponential backoff. Nothing is marked sent. */
  private recordFailure(error: unknown): void {
    // A storage failure is a bug, not Discord trouble: surface it.
    if (error instanceof Database.SqliteError) throw error;
    const { log, now } = this.deps;
    if (error instanceof DiscordApiError && error.isRateLimited && error.retryAfterMs !== null) {
      this.pausedUntil = now() + error.retryAfterMs;
      log.warn('discord rate limited, pausing', { waitMs: error.retryAfterMs });
      return;
    }
    this.failures += 1;
    const waitMs = Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
    this.pausedUntil = now() + waitMs;
    const fields = { failures: this.failures, waitMs, error: describeError(error) };
    const isNoteworthy = this.failures === 1 || this.failures % FAILURE_LOG_EVERY === 0;
    if (isNoteworthy) log.warn('discord post failed, backing off', fields);
    else log.debug('discord post failed, backing off', fields);
  }
}
