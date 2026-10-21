import { IncidentKind, type Problem } from '../domain/incident.js';
import { formatDuration } from '../render/format.js';
import type { HealthSnapshot } from './state.js';

/** A collector counts as healthy only if its last successful poll is at most this old. */
const MAX_HEALTHY_POLL_AGE_MS = 60_000;

export interface HealthThresholds {
  readonly rpcFailThreshold: number;
  /** 0 disables stall detection. */
  readonly stallMs: number;
  readonly minPeers: number;
}

export interface HealthAssessment {
  readonly problems: readonly Problem[];
  /**
   * Kinds whose condition could actually be checked. While the RPC is down, stall, peer and
   * sync state are unknown, so their open incidents must neither resolve nor be opened.
   */
  readonly evaluatedKinds: ReadonlySet<IncidentKind>;
}

const ALL_KINDS: readonly IncidentKind[] = Object.values(IncidentKind);

/** Pure health evaluation of a snapshot at time `now`. */
export function assessHealth(
  snapshot: HealthSnapshot,
  thresholds: HealthThresholds,
  now: number,
): HealthAssessment {
  if (snapshot.consecutiveFailures >= thresholds.rpcFailThreshold) {
    const detail = `Gagal ${snapshot.consecutiveFailures} kali berturut-turut. Error terakhir: ${
      snapshot.lastError ?? '-'
    }`;
    return {
      problems: [{ kind: IncidentKind.RPC_DOWN, detail }],
      evaluatedKinds: new Set([IncidentKind.RPC_DOWN]),
    };
  }
  const problems: Problem[] = [];
  const stalledForMs = now - snapshot.lastHeadChangeAt;
  if (thresholds.stallMs > 0 && stalledForMs >= thresholds.stallMs) {
    problems.push({
      kind: IncidentKind.STALLED,
      detail: `Head tertahan di #${snapshot.lastHead ?? '?'} selama ${formatDuration(stalledForMs)}.`,
    });
  }
  if (snapshot.peers !== null && snapshot.peers < thresholds.minPeers) {
    problems.push({
      kind: IncidentKind.LOW_PEERS,
      detail: `Peer: ${snapshot.peers} (minimum ${thresholds.minPeers}).`,
    });
  }
  if (snapshot.isSyncing === true) {
    problems.push({
      kind: IncidentKind.SYNCING,
      detail: 'eth_syncing melaporkan node sedang sync.',
    });
  }
  return { problems, evaluatedKinds: new Set(ALL_KINDS) };
}

/** Whether the heartbeat may be pinged: recent successful poll and no RPC-down/stall problem. */
export function isCollectorHealthy(
  snapshot: HealthSnapshot,
  thresholds: HealthThresholds,
  now: number,
): boolean {
  if (snapshot.lastPollOkAt === null || now - snapshot.lastPollOkAt > MAX_HEALTHY_POLL_AGE_MS) {
    return false;
  }
  return !assessHealth(snapshot, thresholds, now).problems.some(
    (problem) => problem.kind === IncidentKind.RPC_DOWN || problem.kind === IncidentKind.STALLED,
  );
}
