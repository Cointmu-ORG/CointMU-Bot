import { BlockStatus } from '../domain/block.js';
import type { BlocksRepo } from '../db/blocks-repo.js';
import type { Db } from '../db/database.js';
import type { Logger } from '../logger.js';

export const RETENTION_INTERVAL_MS = 3_600_000;

export interface RetentionDeps {
  readonly db: Db;
  readonly blocks: BlocksRepo;
  readonly retentionMs: number;
  /** Newest canonical blocks always kept (hashrate window, reorg resolution). */
  readonly keepRecentBlocks: number;
  /**
   * False while no announcement chat is set. Unsent blocks then age out normally; otherwise
   * they are kept until announced.
   */
  readonly isAnnouncing: () => boolean;
  readonly log: Logger;
  readonly now: () => number;
}

/**
 * Deletes data older than DATA_RETENTION_DAYS: announced/orphaned blocks, settled messages no
 * block points to, RPC samples and resolved incidents. The wallets table is kept so the
 * first-block badge stays accurate.
 */
export class RetentionJob {
  private readonly purge;

  constructor(private readonly deps: RetentionDeps) {
    const { db } = deps;
    const deleteBlocks = db.prepare(
      `DELETE FROM blocks WHERE first_seen_at < @cutoff AND number < @minNumber
         AND (sent = 1 OR status = '${BlockStatus.ORPHANED}' OR @includeUnsent = 1)`,
    );
    const deleteMessages = db.prepare(
      `DELETE FROM messages WHERE is_settled = 1 AND updated_at < @cutoff
         AND id NOT IN (SELECT message_ref FROM blocks WHERE message_ref IS NOT NULL)`,
    );
    const deleteSamples = db.prepare('DELETE FROM rpc_samples WHERE minute_start < @cutoff');
    const deletePending = db.prepare('DELETE FROM pending_actions WHERE expires_at < @cutoff');
    const deleteIncidents = db.prepare(
      'DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < @cutoff',
    );
    this.purge = db.transaction((cutoff: number, minNumber: number, includeUnsent: boolean) => {
      const params = { cutoff, minNumber, includeUnsent: includeUnsent ? 1 : 0 };
      return {
        blocks: deleteBlocks.run(params).changes,
        messages: deleteMessages.run({ cutoff }).changes,
        samples: deleteSamples.run({ cutoff }).changes,
        incidents: deleteIncidents.run({ cutoff }).changes,
        pendingActions: deletePending.run({ cutoff }).changes,
      };
    });
  }

  tick(): Promise<void> {
    const tip = this.deps.blocks.getTip();
    if (!tip) return Promise.resolve();
    const deleted = this.purge(
      this.deps.now() - this.deps.retentionMs,
      tip.number - this.deps.keepRecentBlocks,
      !this.deps.isAnnouncing(),
    );
    const total = Object.values(deleted).reduce((sum, count) => sum + count, 0);
    if (total > 0) this.deps.log.info('retention cleanup', deleted);
    return Promise.resolve();
  }
}
