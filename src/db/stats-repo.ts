import { BlockStatus } from '../domain/block.js';
import type { Db } from './database.js';

export interface MinerCount {
  readonly miner: string;
  readonly blocks: number;
}

export interface Leaderboard {
  readonly total: number;
  readonly top: readonly MinerCount[];
}

/** Aggregate queries for the /top command. */
export class StatsRepo {
  private readonly byBlockTimeStmt;
  private readonly bySeenTimeStmt;

  constructor(db: Db) {
    const canonical = `status = '${BlockStatus.CANONICAL}'`;
    this.byBlockTimeStmt = db.prepare<[number], MinerCount>(
      `SELECT miner, COUNT(*) AS blocks FROM blocks WHERE ${canonical} AND timestamp >= ?
       GROUP BY miner ORDER BY blocks DESC, miner ASC`,
    );
    this.bySeenTimeStmt = db.prepare<[number], MinerCount>(
      `SELECT miner, COUNT(*) AS blocks FROM blocks WHERE ${canonical} AND first_seen_at >= ?
       GROUP BY miner ORDER BY blocks DESC, miner ASC`,
    );
  }

  /** Canonical blocks whose chain timestamp (unix seconds) is >= sinceUnixS. */
  leaderboardSinceBlockTime(sinceUnixS: number, limit: number): Leaderboard {
    return toLeaderboard(this.byBlockTimeStmt.all(sinceUnixS), limit);
  }

  /** Canonical blocks the bot first stored at or after sinceMs (e.g. this session). */
  leaderboardSinceSeen(sinceMs: number, limit: number): Leaderboard {
    return toLeaderboard(this.bySeenTimeStmt.all(sinceMs), limit);
  }
}

function toLeaderboard(rows: readonly MinerCount[], limit: number): Leaderboard {
  return {
    total: rows.reduce((sum, row) => sum + row.blocks, 0),
    top: rows.slice(0, limit),
  };
}
