import type { ChainBlock } from '../domain/block.js';
import { RpcResponseError, type ChainReader } from '../rpc/client.js';

/** Deepest reorg resolved block by block; deeper ones are accepted wholesale and alerted. */
export const MAX_REORG_DEPTH = 64;

export interface ForkResolution {
  /** Highest block number on which the stored chain and the node agree. */
  readonly forkNumber: number;
  /** The node's blocks above forkNumber, ascending. */
  readonly replacement: readonly ChainBlock[];
  /** True when no common ancestor was found within maxDepth blocks. */
  readonly isDeep: boolean;
}

/** Minimal read access to the stored canonical chain. */
export interface CanonicalLookup {
  getCanonical(number: number): { readonly hash: string } | null;
}

/**
 * Walks down from `fromNumber`, comparing the node's block hash with the stored canonical hash
 * at each height, until they match. Heights the DB does not have (below the backfill start)
 * are treated as agreeing, since there is nothing stored to orphan there.
 */
export async function findForkPoint(
  chain: ChainReader,
  stored: CanonicalLookup,
  fromNumber: number,
  maxDepth: number = MAX_REORG_DEPTH,
): Promise<ForkResolution> {
  const replacement: ChainBlock[] = [];
  for (let number = fromNumber; number >= 0 && replacement.length < maxDepth; number -= 1) {
    const local = stored.getCanonical(number);
    if (!local) return { forkNumber: number, replacement: replacement.reverse(), isDeep: false };
    const remote = await chain.getBlock(number);
    if (!remote) throw new RpcResponseError(`block ${number} missing while resolving a reorg`);
    if (remote.hash === local.hash) {
      return { forkNumber: number, replacement: replacement.reverse(), isDeep: false };
    }
    replacement.push(remote);
  }
  return {
    forkNumber: fromNumber - replacement.length,
    replacement: replacement.reverse(),
    isDeep: replacement.length >= maxDepth,
  };
}
