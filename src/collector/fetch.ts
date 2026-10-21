import type { ChainBlock } from '../domain/block.js';
import type { ChainReader } from '../rpc/client.js';

/** Blocks fetched concurrently per batch during catch-up / backfill. */
export const FETCH_BATCH_SIZE = 20;

/**
 * Fetches blocks from..to (inclusive, ascending) concurrently. Stops at the first missing
 * block, so the result is always a contiguous prefix of the range.
 */
export async function fetchRange(
  chain: ChainReader,
  from: number,
  to: number,
): Promise<ChainBlock[]> {
  const numbers = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const fetched = await Promise.all(numbers.map((n) => chain.getBlock(n)));
  const missingAt = fetched.indexOf(null);
  const contiguous = missingAt === -1 ? fetched : fetched.slice(0, missingAt);
  return contiguous.filter((block): block is ChainBlock => block !== null);
}

/** Splits from..to into [start, end] pairs of at most `size` blocks. */
export function batchRanges(
  from: number,
  to: number,
  size: number = FETCH_BATCH_SIZE,
): [number, number][] {
  const ranges: [number, number][] = [];
  for (let start = from; start <= to; start += size) {
    ranges.push([start, Math.min(to, start + size - 1)]);
  }
  return ranges;
}
