import type { HealthState } from '../health/state.js';
import { describeError, type Logger } from '../logger.js';
import type { ChainReader } from '../rpc/client.js';

export const NODE_PROBE_INTERVAL_MS = 15_000;

/** Samples net_peerCount and eth_syncing for the health monitor. */
export class NodeProbe {
  constructor(
    private readonly chain: ChainReader,
    private readonly health: HealthState,
    private readonly log: Logger,
    private readonly now: () => number,
  ) {}

  async tick(): Promise<void> {
    try {
      const [peers, isSyncing] = await Promise.all([
        this.chain.getPeerCount(),
        this.chain.isSyncing(),
      ]);
      this.health.recordNodeStatus({ peers, isSyncing }, this.now());
    } catch (error) {
      // Unreachable RPC is already tracked (and alerted) through the collector's poll failures.
      this.log.debug('node probe failed', { error: describeError(error) });
    }
  }
}
