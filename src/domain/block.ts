export const BlockStatus = {
  CANONICAL: 'canonical',
  ORPHANED: 'orphaned',
} as const;
export type BlockStatus = (typeof BlockStatus)[keyof typeof BlockStatus];

/** Block header fields as read from the node (eth_getBlockByNumber without full transactions). */
export interface ChainBlock {
  readonly number: number;
  readonly hash: string;
  readonly parentHash: string;
  readonly miner: string;
  /** Unix seconds. */
  readonly timestamp: number;
  readonly difficulty: bigint;
  readonly nonce: string;
  readonly mixHash: string;
  readonly txCount: number;
}

/** A persisted block plus bookkeeping and the values derived when it was inserted. */
export interface StoredBlock extends ChainBlock {
  /** Epoch ms when the bot first stored this block. */
  readonly firstSeenAt: number;
  readonly status: BlockStatus;
  readonly isSent: boolean;
  readonly messageRef: number | null;
  /** Consecutive canonical blocks by the same miner, ending at this block. */
  readonly streak: number;
  /** Seconds since the parent block, null when the parent is unknown. */
  readonly blockTimeS: number | null;
  /** Network hashrate (H/s) over the configured window ending at this block. */
  readonly hashrateHps: number | null;
  readonly isFirstForWallet: boolean;
}
