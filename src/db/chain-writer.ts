import { BlockStatus, type ChainBlock } from '../domain/block.js';
import { computeHashrate } from '../stats/hashrate.js';
import type { BlocksRepo } from './blocks-repo.js';
import type { Db } from './database.js';

export interface WriteOptions {
  readonly now: number;
  /**
   * Seed blocks (the initial backfill on an empty DB) are stored as already sent and never
   * earn the first-block badge: they only feed stats and the wallet table.
   */
  readonly isSeed: boolean;
}

/** All writes that change which blocks are canonical. Each public call is one transaction. */
export class ChainWriter {
  private readonly upsertBlockStmt;
  private readonly insertWalletStmt;
  private readonly reopenByHashStmt;
  private readonly reopenAboveStmt;
  private readonly orphanAboveStmt;

  constructor(
    private readonly db: Db,
    private readonly blocks: BlocksRepo,
    private readonly hashrateWindow: number,
    /**
     * While false, new blocks are stored as already on Discord, so turning Discord on later
     * posts only blocks from then on.
     */
    private readonly isDiscordEnabled = false,
  ) {
    this.upsertBlockStmt = db.prepare(
      `INSERT INTO blocks (hash, number, parent_hash, miner, timestamp, difficulty, nonce, mix_hash,
         tx_count, first_seen_at, status, sent, discord_sent, streak, block_time_s, hashrate_hps,
         is_first_for_wallet, created_at, updated_at)
       VALUES (@hash, @number, @parentHash, @miner, @timestamp, @difficulty, @nonce, @mixHash,
         @txCount, @now, '${BlockStatus.CANONICAL}', @sent, @discordSent, @streak, @blockTimeS,
         @hashrateHps, @isFirstForWallet, @now, @now)
       ON CONFLICT (hash) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    );
    this.insertWalletStmt = db.prepare(
      `INSERT OR IGNORE INTO wallets (address, first_block, first_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.reopenByHashStmt = db.prepare(
      `UPDATE messages SET is_settled = 0, updated_at = ?
       WHERE id = (SELECT message_ref FROM blocks WHERE hash = ?)`,
    );
    this.reopenAboveStmt = db.prepare(
      `UPDATE messages SET is_settled = 0, updated_at = ?
       WHERE id IN (SELECT message_ref FROM blocks
                    WHERE status = '${BlockStatus.CANONICAL}' AND number > ?)`,
    );
    this.orphanAboveStmt = db.prepare(
      `UPDATE blocks SET status = '${BlockStatus.ORPHANED}', updated_at = ?
       WHERE status = '${BlockStatus.CANONICAL}' AND number > ?`,
    );
  }

  /** Appends blocks (ascending, each extending the current canonical tip). */
  appendBlocks(blocks: readonly ChainBlock[], options: WriteOptions): void {
    this.db.transaction(() => {
      for (const block of blocks) this.insertOne(block, options);
    })();
  }

  /**
   * Marks every canonical block above `forkNumber` as orphaned, then appends `newChain`
   * (ascending, starting at forkNumber + 1). Returns how many blocks were orphaned.
   */
  applyReorg(forkNumber: number, newChain: readonly ChainBlock[], now: number): number {
    return this.db.transaction(() => {
      // Messages that showed a now-orphaned block must be re-rendered, even if already settled.
      this.reopenAboveStmt.run(now, forkNumber);
      const orphaned = this.orphanAboveStmt.run(now, forkNumber).changes;
      for (const block of newChain) this.insertOne(block, { now, isSeed: false });
      return orphaned;
    })();
  }

  private insertOne(block: ChainBlock, { now, isSeed }: WriteOptions): void {
    const parent = this.blocks.getCanonical(block.number - 1);
    const window = this.blocks.listCanonicalRange(
      block.number - this.hashrateWindow,
      block.number - 1,
    );
    const isNewWallet =
      this.insertWalletStmt.run(block.miner, block.number, now, now, now).changes === 1;
    this.upsertBlockStmt.run({
      hash: block.hash,
      number: block.number,
      parentHash: block.parentHash,
      miner: block.miner,
      timestamp: block.timestamp,
      difficulty: block.difficulty.toString(),
      nonce: block.nonce,
      mixHash: block.mixHash,
      txCount: block.txCount,
      now,
      sent: isSeed ? 1 : 0,
      discordSent: isSeed || !this.isDiscordEnabled ? 1 : 0,
      streak: parent?.miner === block.miner ? parent.streak + 1 : 1,
      blockTimeS: parent ? block.timestamp - parent.timestamp : null,
      hashrateHps: computeHashrate([...window, block]),
      isFirstForWallet: isNewWallet && !isSeed ? 1 : 0,
    });
    // A previously orphaned block can become canonical again: let its message re-render.
    // No-op for fresh blocks, which have no message yet.
    this.reopenByHashStmt.run(now, block.hash);
  }
}
