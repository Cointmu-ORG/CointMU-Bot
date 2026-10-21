import { setTimeout as delay } from 'node:timers/promises';
import { describeError, type Logger } from '../logger.js';
import type { ChainReader } from './client.js';

const RETRY_DELAY_MS = 5_000;

export class ChainMismatchError extends Error {
  override name = 'ChainMismatchError';
}

export interface WaitOptions {
  readonly expectedChainId: number;
  readonly log: Logger;
  readonly signal: AbortSignal;
  /** Called on every failed attempt, so an unreachable node is alerted even at startup. */
  readonly onUnreachable: (error: unknown) => void;
}

/**
 * Blocks until the node answers eth_chainId. Retries while the node is unreachable, but throws
 * ChainMismatchError straight away if it reports a different chain (wrong RPC_URL).
 */
export async function waitForExpectedChain(
  chain: ChainReader,
  options: WaitOptions,
): Promise<void> {
  const { expectedChainId, log, signal } = options;
  for (;;) {
    try {
      const chainId = await chain.getChainId();
      if (chainId !== expectedChainId) {
        throw new ChainMismatchError(`node reports chain ${chainId}, expected ${expectedChainId}`);
      }
      log.info('connected to node', { chainId });
      return;
    } catch (error) {
      if (error instanceof ChainMismatchError) throw error;
      log.warn('node not reachable yet, retrying', { error: describeError(error) });
      options.onUnreachable(error);
    }
    await delay(RETRY_DELAY_MS, undefined, { signal });
  }
}
