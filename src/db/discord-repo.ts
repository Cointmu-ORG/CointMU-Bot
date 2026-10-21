import { BlockStatus, type StoredBlock } from '../domain/block.js';
import { BLOCK_COLUMNS, toStoredBlock, type BlockRow } from './blocks-repo.js';
import type { Db } from './database.js';

/** Canonical blocks waiting for Discord, up to some block number. */
export interface PendingRange {
  readonly count: number;
  readonly from: number;
  readonly to: number;
}

interface RangeRow {
  count: number;
  first: number | null;
  last: number | null;
}

/** Discord #block-update delivery state (`blocks.discord_sent`), separate from Telegram's. */
export class DiscordRepo {
  private readonly pendingStmt;
  private readonly rangeStmt;
  private readonly markStmt;
  private readonly markUpToStmt;

  constructor(private readonly db: Db) {
    const pending = `status = '${BlockStatus.CANONICAL}' AND discord_sent = 0 AND number <= ?`;
    this.pendingStmt = db.prepare<[number, number], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE ${pending} ORDER BY number ASC LIMIT ?`,
    );
    this.rangeStmt = db.prepare<[number], RangeRow>(
      `SELECT COUNT(*) AS count, MIN(number) AS first, MAX(number) AS last FROM blocks
       WHERE ${pending}`,
    );
    this.markStmt = db.prepare('UPDATE blocks SET discord_sent = 1, updated_at = ? WHERE hash = ?');
    this.markUpToStmt = db.prepare(
      `UPDATE blocks SET discord_sent = 1, updated_at = ? WHERE ${pending}`,
    );
  }

  /** Canonical blocks with number <= maxNumber not yet on Discord, ascending. */
  listPending(maxNumber: number, limit: number): StoredBlock[] {
    return this.pendingStmt.all(maxNumber, limit).map(toStoredBlock);
  }

  /** Null when nothing up to maxNumber is waiting. */
  countPending(maxNumber: number): PendingRange | null {
    const row = this.rangeStmt.get(maxNumber);
    if (!row || row.first === null || row.last === null) return null;
    return { count: row.count, from: row.first, to: row.last };
  }

  /** Call only after Discord accepted the message, so a crash can never skip a block. */
  markSent(hashes: readonly string[], now: number): void {
    this.db.transaction(() => {
      for (const hash of hashes) this.markStmt.run(now, hash);
    })();
  }

  /** Marks every waiting block up to maxNumber as delivered without posting it; returns how many. */
  markSentUpTo(maxNumber: number, now: number): number {
    return this.markUpToStmt.run(now, maxNumber).changes;
  }
}
