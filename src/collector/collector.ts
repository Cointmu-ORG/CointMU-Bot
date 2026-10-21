import Database from 'better-sqlite3';
import type { BlocksRepo } from '../db/blocks-repo.js';
import type { ChainWriter } from '../db/chain-writer.js';
import type { ChainBlock } from '../domain/block.js';
import type { HealthState } from '../health/state.js';
import { describeError, type Logger } from '../logger.js';
import type { ChainReader } from '../rpc/client.js';
import { batchRanges, fetchRange } from './fetch.js';
import { findForkPoint, type ForkResolution } from './reorg.js';

/** Log every Nth consecutive poll failure at warn level; the rest go to debug. */
const FAILURE_LOG_EVERY = 60;

export interface DeepReorgInfo {
  readonly forkNumber: number;
  readonly orphaned: number;
}

export interface CollectorDeps {
  readonly chain: ChainReader;
  readonly blocks: BlocksRepo;
  readonly writer: ChainWriter;
  readonly health: HealthState;
  readonly startBackfill: number;
  readonly log: Logger;
  readonly now: () => number;
  readonly onDeepReorg: (info: DeepReorgInfo) => void;
}

/** Polls the head and keeps the stored canonical chain in sync with the node. */
export class Collector {
  constructor(private readonly deps: CollectorDeps) {}

  async tick(): Promise<void> {
    try {
      const head = await this.deps.chain.getBlockNumber();
      await this.sync(head);
      this.deps.health.recordPollSuccess(head, this.deps.now());
    } catch (error) {
      // A storage failure is a bug, not node trouble: surface it instead of counting it as RPC down.
      if (error instanceof Database.SqliteError) throw error;
      const failures = this.deps.health.recordPollFailure(error, this.deps.now());
      const isNoteworthy = failures === 1 || failures % FAILURE_LOG_EVERY === 0;
      const fields = { failures, error: describeError(error) };
      if (isNoteworthy) this.deps.log.warn('rpc poll failed', fields);
      else this.deps.log.debug('rpc poll failed', fields);
    }
  }

  private async sync(head: number): Promise<void> {
    const tip = this.deps.blocks.getTip();
    if (!tip) return this.seed(head);
    if (head === tip.number) return;
    // The node's head moved below ours: only a reorg onto a shorter (heavier) chain does that.
    if (head < tip.number) {
      return this.reconcile(await findForkPoint(this.deps.chain, this.deps.blocks, head));
    }
    return this.catchUp(tip.number + 1, head);
  }

  /** Empty DB: store the last START_BACKFILL blocks silently (stats only, not announced). */
  private async seed(head: number): Promise<void> {
    const from = Math.max(0, head - this.deps.startBackfill);
    const blocks: ChainBlock[] = [];
    for (const [start, end] of batchRanges(from, head)) {
      blocks.push(...(await fetchRange(this.deps.chain, start, end)));
    }
    this.deps.writer.appendBlocks(blocks, { now: this.deps.now(), isSeed: true });
    this.deps.log.info('seeded database', { from, to: blocks.at(-1)?.number ?? null });
  }

  private async catchUp(from: number, head: number): Promise<void> {
    for (const [start, end] of batchRanges(from, head)) {
      const fetched = await fetchRange(this.deps.chain, start, end);
      for (const block of fetched) {
        const parent = this.deps.blocks.getCanonical(block.number - 1);
        if (parent && parent.hash !== block.parentHash) {
          const fork = await findForkPoint(this.deps.chain, this.deps.blocks, block.number - 1);
          return this.reconcile({ ...fork, replacement: [...fork.replacement, block] });
        }
        this.deps.writer.appendBlocks([block], { now: this.deps.now(), isSeed: false });
        this.deps.log.debug('stored block', { number: block.number, miner: block.miner });
      }
      // Shorter than requested: the node's chain changed mid-fetch; continue next tick.
      if (fetched.length < end - start + 1) return;
    }
  }

  private reconcile(fork: ForkResolution): void {
    const orphaned = this.deps.writer.applyReorg(
      fork.forkNumber,
      fork.replacement,
      this.deps.now(),
    );
    this.deps.log.warn('reorg detected', {
      forkNumber: fork.forkNumber,
      orphaned,
      newTip: fork.replacement.at(-1)?.number ?? fork.forkNumber,
    });
    if (fork.isDeep) this.deps.onDeepReorg({ forkNumber: fork.forkNumber, orphaned });
  }
}
