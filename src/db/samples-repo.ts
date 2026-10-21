import type { Db } from './database.js';

const MS_PER_MINUTE = 60_000;

export type PollOutcome =
  { readonly ok: true; readonly head: number } | { readonly ok: false; readonly error: string };

export interface NodeStatus {
  readonly peers: number;
  readonly isSyncing: boolean;
}

/**
 * Per-minute aggregates of every RPC poll (success/failure counts plus the last head, peer
 * count, syncing flag and error). One row per minute keeps a 1 s poll interval cheap to store.
 */
export class SamplesRepo {
  private readonly pollStmt;
  private readonly statusStmt;

  constructor(db: Db) {
    this.pollStmt = db.prepare(
      `INSERT INTO rpc_samples (minute_start, ok_count, fail_count, last_head, last_error,
         created_at, updated_at)
       VALUES (@minute, @ok, @fail, @head, @error, @now, @now)
       ON CONFLICT (minute_start) DO UPDATE SET
         ok_count = ok_count + excluded.ok_count,
         fail_count = fail_count + excluded.fail_count,
         last_head = COALESCE(excluded.last_head, last_head),
         last_error = COALESCE(excluded.last_error, last_error),
         updated_at = excluded.updated_at`,
    );
    this.statusStmt = db.prepare(
      `INSERT INTO rpc_samples (minute_start, last_peers, last_syncing, created_at, updated_at)
       VALUES (@minute, @peers, @syncing, @now, @now)
       ON CONFLICT (minute_start) DO UPDATE SET
         last_peers = excluded.last_peers,
         last_syncing = excluded.last_syncing,
         updated_at = excluded.updated_at`,
    );
  }

  recordPoll(outcome: PollOutcome, now: number): void {
    this.pollStmt.run({
      minute: minuteStart(now),
      ok: outcome.ok ? 1 : 0,
      fail: outcome.ok ? 0 : 1,
      head: outcome.ok ? outcome.head : null,
      error: outcome.ok ? null : outcome.error,
      now,
    });
  }

  recordNodeStatus(status: NodeStatus, now: number): void {
    this.statusStmt.run({
      minute: minuteStart(now),
      peers: status.peers,
      syncing: status.isSyncing ? 1 : 0,
      now,
    });
  }
}

function minuteStart(epochMs: number): number {
  return epochMs - (epochMs % MS_PER_MINUTE);
}
