import { describe, expect, it } from 'vitest';
import { BlocksRepo } from '../../src/db/blocks-repo.js';
import { ChainWriter } from '../../src/db/chain-writer.js';
import { openDatabase } from '../../src/db/database.js';
import type { ChainBlock } from '../../src/domain/block.js';
import { RetentionJob } from '../../src/maintenance/retention.js';
import { silentLog } from '../support/harness.js';

const DAY_MS = 86_400_000;

const chainBlock = (number: number): ChainBlock => ({
  number,
  hash: `0x${number.toString(16).padStart(64, '0')}`,
  parentHash: `0x${(number - 1).toString(16).padStart(64, '0')}`,
  miner: number < 5 ? '0xold' : '0xnew',
  timestamp: number * 12,
  difficulty: 1000n,
  nonce: '0x1',
  mixHash: '0x2',
  txCount: 0,
});

describe('RetentionJob', () => {
  it('deletes old announced blocks but keeps recent ones and the wallet history', async () => {
    const db = openDatabase(':memory:');
    const blocks = new BlocksRepo(db);
    const writer = new ChainWriter(db, blocks, 2);
    writer.appendBlocks([0, 1, 2, 3, 4, 5, 6, 7].map(chainBlock), { now: 0, isSeed: true });
    writer.appendBlocks([8, 9].map(chainBlock), { now: 40 * DAY_MS, isSeed: false });
    const job = new RetentionJob({
      db,
      blocks,
      retentionMs: 30 * DAY_MS,
      keepRecentBlocks: 3,
      isAnnouncing: () => true,
      log: silentLog,
      now: () => 40 * DAY_MS,
    });

    await job.tick();

    const remaining = blocks.listCanonicalRange(0, 100).map((b) => b.number);
    expect(remaining).toEqual([6, 7, 8, 9]);
    const wallets = db.prepare<[], { address: string }>('SELECT address FROM wallets').all();
    expect(wallets.map((w) => w.address).sort()).toEqual(['0xnew', '0xold']);
    db.close();
  });

  describe('unsent blocks', () => {
    // Blocks 0..4 stored 40 days ago and 5..9 stored 10 days ago, none announced.
    const runWith = async (isAnnouncing: boolean) => {
      const db = openDatabase(':memory:');
      const blocks = new BlocksRepo(db);
      const writer = new ChainWriter(db, blocks, 2);
      writer.appendBlocks([0, 1, 2, 3, 4].map(chainBlock), { now: 0, isSeed: false });
      writer.appendBlocks([5, 6, 7, 8, 9].map(chainBlock), { now: 30 * DAY_MS, isSeed: false });
      const job = new RetentionJob({
        db,
        blocks,
        retentionMs: 30 * DAY_MS,
        keepRecentBlocks: 3,
        isAnnouncing: () => isAnnouncing,
        log: silentLog,
        now: () => 40 * DAY_MS,
      });
      await job.tick();
      const remaining = blocks.listCanonicalRange(0, 100).map((b) => b.number);
      db.close();
      return remaining;
    };

    it('age out normally while no announcement chat is set, never earlier', async () => {
      expect(await runWith(false)).toEqual([5, 6, 7, 8, 9]);
    });

    it('are kept until announced while an announcement chat is set', async () => {
      expect(await runWith(true)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});
