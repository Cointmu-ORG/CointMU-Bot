export interface ChainSample {
  /** Unix seconds. */
  readonly timestamp: number;
  readonly difficulty: bigint;
}

/**
 * Network hashrate in H/s from ascending blocks [b0 .. bN]: the summed difficulty of b1..bN
 * divided by (bN.timestamp - b0.timestamp). Pass HASHRATE_WINDOW + 1 blocks for a window of N.
 * Returns null when there is not enough data or the time span is not positive.
 */
export function computeHashrate(blocks: readonly ChainSample[]): number | null {
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last || blocks.length < 2) return null;
  const spanSeconds = last.timestamp - first.timestamp;
  if (spanSeconds <= 0) return null;
  const work = blocks.slice(1).reduce((sum, block) => sum + block.difficulty, 0n);
  return Number(work) / spanSeconds;
}

/** Mean seconds between consecutive ascending blocks, or null with fewer than two blocks. */
export function averageBlockTime(blocks: readonly ChainSample[]): number | null {
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last || blocks.length < 2) return null;
  return (last.timestamp - first.timestamp) / (blocks.length - 1);
}
