import { BlockStatus, type StoredBlock } from '../domain/block.js';
import type { Db } from './database.js';

const BLOCK_COLUMNS = `hash, number, parent_hash, miner, timestamp, difficulty, nonce, mix_hash,
  tx_count, first_seen_at, status, sent, message_ref, streak, block_time_s, hashrate_hps,
  is_first_for_wallet`;

interface BlockRow {
  hash: string;
  number: number;
  parent_hash: string;
  miner: string;
  timestamp: number;
  difficulty: string;
  nonce: string;
  mix_hash: string;
  tx_count: number;
  first_seen_at: number;
  status: BlockStatus;
  sent: number;
  message_ref: number | null;
  streak: number;
  block_time_s: number | null;
  hashrate_hps: number | null;
  is_first_for_wallet: number;
}

function toStoredBlock(row: BlockRow): StoredBlock {
  return {
    number: row.number,
    hash: row.hash,
    parentHash: row.parent_hash,
    miner: row.miner,
    timestamp: row.timestamp,
    difficulty: BigInt(row.difficulty),
    nonce: row.nonce,
    mixHash: row.mix_hash,
    txCount: row.tx_count,
    firstSeenAt: row.first_seen_at,
    status: row.status,
    isSent: row.sent === 1,
    messageRef: row.message_ref,
    streak: row.streak,
    blockTimeS: row.block_time_s,
    hashrateHps: row.hashrate_hps,
    isFirstForWallet: row.is_first_for_wallet === 1,
  };
}

/** Read-side queries over the `blocks` table. Writes live in ChainWriter / MessagesRepo. */
export class BlocksRepo {
  private readonly tipStmt;
  private readonly canonicalStmt;
  private readonly rangeStmt;
  private readonly recentStmt;
  private readonly unsentStmt;
  private readonly byMessageStmt;

  constructor(db: Db) {
    const canonical = `status = '${BlockStatus.CANONICAL}'`;
    this.tipStmt = db.prepare<[], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE ${canonical} ORDER BY number DESC LIMIT 1`,
    );
    this.canonicalStmt = db.prepare<[number], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE ${canonical} AND number = ?`,
    );
    this.rangeStmt = db.prepare<[number, number], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE ${canonical} AND number BETWEEN ? AND ?
       ORDER BY number ASC`,
    );
    this.recentStmt = db.prepare<[number], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE ${canonical} ORDER BY number DESC LIMIT ?`,
    );
    this.unsentStmt = db.prepare<[number], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE ${canonical} AND sent = 0
       ORDER BY number ASC LIMIT ?`,
    );
    this.byMessageStmt = db.prepare<[number], BlockRow>(
      `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE message_ref = ? ORDER BY number ASC`,
    );
  }

  /** Highest canonical block, or null when the database is empty. */
  getTip(): StoredBlock | null {
    const row = this.tipStmt.get();
    return row ? toStoredBlock(row) : null;
  }

  getCanonical(number: number): StoredBlock | null {
    const row = this.canonicalStmt.get(number);
    return row ? toStoredBlock(row) : null;
  }

  /** Canonical blocks with from <= number <= to, ascending. */
  listCanonicalRange(from: number, to: number): StoredBlock[] {
    return this.rangeStmt.all(from, to).map(toStoredBlock);
  }

  /** Newest canonical blocks first. */
  listRecentCanonical(limit: number): StoredBlock[] {
    return this.recentStmt.all(limit).map(toStoredBlock);
  }

  /** Canonical blocks not yet announced, ascending. */
  listUnsent(limit: number): StoredBlock[] {
    return this.unsentStmt.all(limit).map(toStoredBlock);
  }

  /** Every block (canonical or orphaned) shown in a given message, ascending. */
  listByMessage(messageRef: number): StoredBlock[] {
    return this.byMessageStmt.all(messageRef).map(toStoredBlock);
  }
}
