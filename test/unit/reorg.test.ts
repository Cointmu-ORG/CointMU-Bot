import { describe, expect, it } from 'vitest';
import { findForkPoint } from '../../src/collector/reorg.js';
import type { ChainBlock } from '../../src/domain/block.js';
import type { ChainReader } from '../../src/rpc/client.js';

function chainBlock(number: number, fork: string): ChainBlock {
  return {
    number,
    hash: `0x${fork}${number}`,
    parentHash: `0x${fork}${number - 1}`,
    miner: '0xminer',
    timestamp: number * 10,
    difficulty: 1n,
    nonce: '0x0',
    mixHash: '0x0',
    txCount: 0,
  };
}

/** Node whose chain is `a` up to `forkAt`, then `b` above it. */
function nodeWithFork(forkAt: number, head: number): ChainReader {
  return {
    getBlock: (n) => Promise.resolve(n > head ? null : chainBlock(n, n > forkAt ? 'b' : 'a')),
    getBlockNumber: () => Promise.resolve(head),
    getPeerCount: () => Promise.resolve(1),
    isSyncing: () => Promise.resolve(false),
    getChainId: () => Promise.resolve(1912),
    close: () => undefined,
  };
}

/** Stored canonical chain: fork `a` for numbers from..to. */
function storedChain(from: number, to: number) {
  return {
    getCanonical: (n: number) => (n >= from && n <= to ? { hash: `0xa${n}` } : null),
  };
}

describe('findForkPoint', () => {
  it('finds the common ancestor and returns the new branch ascending', async () => {
    const result = await findForkPoint(nodeWithFork(98, 101), storedChain(50, 100), 100);

    expect(result.forkNumber).toBe(98);
    expect(result.replacement.map((b) => b.hash)).toEqual(['0xb99', '0xb100']);
    expect(result.isDeep).toBe(false);
  });

  it('returns no replacement when the stored chain already matches', async () => {
    const result = await findForkPoint(nodeWithFork(200, 101), storedChain(50, 100), 100);

    expect(result).toEqual({ forkNumber: 100, replacement: [], isDeep: false });
  });

  it('stops at the start of the stored history', async () => {
    const result = await findForkPoint(nodeWithFork(10, 101), storedChain(95, 100), 100);

    expect(result.forkNumber).toBe(94);
    expect(result.replacement).toHaveLength(6);
  });

  it('flags reorgs deeper than the limit', async () => {
    const result = await findForkPoint(nodeWithFork(10, 101), storedChain(0, 100), 100, 5);

    expect(result.isDeep).toBe(true);
    expect(result.forkNumber).toBe(95);
    expect(result.replacement.map((b) => b.number)).toEqual([96, 97, 98, 99, 100]);
  });
});
