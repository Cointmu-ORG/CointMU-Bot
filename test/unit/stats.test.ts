import { describe, expect, it } from 'vitest';
import { getBlockState } from '../../src/stats/confirmations.js';
import { averageBlockTime, computeHashrate } from '../../src/stats/hashrate.js';

const sample = (timestamp: number, difficulty: bigint) => ({ timestamp, difficulty });

describe('computeHashrate', () => {
  it('divides the window difficulty by the time span to the block before the window', () => {
    // Window of 2 blocks (b1, b2) measured from b0: (2000 + 4000) / (130 - 100).
    const blocks = [sample(100, 999n), sample(110, 2000n), sample(130, 4000n)];

    expect(computeHashrate(blocks)).toBe(200);
  });

  it('returns null for a zero time span instead of dividing by zero', () => {
    expect(computeHashrate([sample(100, 1n), sample(100, 5n)])).toBeNull();
  });

  it('returns null with fewer than two blocks', () => {
    expect(computeHashrate([sample(100, 1n)])).toBeNull();
    expect(computeHashrate([])).toBeNull();
  });
});

describe('averageBlockTime', () => {
  it('averages the gaps between consecutive blocks', () => {
    expect(averageBlockTime([sample(0, 1n), sample(10, 1n), sample(40, 1n)])).toBe(20);
  });

  it('returns null with a single block', () => {
    expect(averageBlockTime([sample(0, 1n)])).toBeNull();
  });
});

describe('getBlockState', () => {
  const base = { number: 100, isOrphaned: false, required: 6 };

  it('counts the block itself as the first confirmation', () => {
    expect(getBlockState({ ...base, head: 100 })).toEqual({ kind: 'pending', confirmations: 1 });
    expect(getBlockState({ ...base, head: 104 })).toEqual({ kind: 'pending', confirmations: 5 });
  });

  it('becomes final exactly at the required confirmations', () => {
    expect(getBlockState({ ...base, head: 105 })).toEqual({ kind: 'final' });
  });

  it('reports orphaned regardless of depth', () => {
    expect(getBlockState({ ...base, isOrphaned: true, head: 200 })).toEqual({ kind: 'orphaned' });
  });

  it('never reports negative confirmations when the head is below the block', () => {
    expect(getBlockState({ ...base, head: 98 })).toEqual({ kind: 'pending', confirmations: 0 });
  });
});
