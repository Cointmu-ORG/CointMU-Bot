import { describeError } from '../logger.js';
import type { NodeStatus, SamplesRepo } from '../db/samples-repo.js';

export interface HealthSnapshot {
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastHead: number | null;
  /** Epoch ms of the last head change (or process start). Drives stall detection. */
  readonly lastHeadChangeAt: number;
  readonly lastPollOkAt: number | null;
  readonly peers: number | null;
  readonly isSyncing: boolean | null;
}

/** In-memory view of node health fed by the collector and node probe; also persists samples. */
export class HealthState {
  private current: HealthSnapshot;

  constructor(
    private readonly samples: SamplesRepo,
    startedAt: number,
  ) {
    this.current = {
      consecutiveFailures: 0,
      lastError: null,
      lastHead: null,
      lastHeadChangeAt: startedAt,
      lastPollOkAt: null,
      peers: null,
      isSyncing: null,
    };
  }

  snapshot(): HealthSnapshot {
    return this.current;
  }

  recordPollSuccess(head: number, now: number): void {
    const previous = this.current;
    this.current = {
      ...previous,
      consecutiveFailures: 0,
      lastHead: head,
      lastHeadChangeAt: head === previous.lastHead ? previous.lastHeadChangeAt : now,
      lastPollOkAt: now,
    };
    this.samples.recordPoll({ ok: true, head }, now);
  }

  /** Returns the new consecutive failure count. */
  recordPollFailure(error: unknown, now: number): number {
    const message = describeError(error);
    const consecutiveFailures = this.current.consecutiveFailures + 1;
    this.current = { ...this.current, consecutiveFailures, lastError: message };
    this.samples.recordPoll({ ok: false, error: message }, now);
    return consecutiveFailures;
  }

  recordNodeStatus(status: NodeStatus, now: number): void {
    this.current = { ...this.current, peers: status.peers, isSyncing: status.isSyncing };
    this.samples.recordNodeStatus(status, now);
  }
}
