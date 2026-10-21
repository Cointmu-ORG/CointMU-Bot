export type BlockState =
  | { readonly kind: 'pending'; readonly confirmations: number }
  | { readonly kind: 'final' }
  | { readonly kind: 'orphaned' };

export interface BlockStateInput {
  readonly number: number;
  readonly isOrphaned: boolean;
  /** Current canonical head number. */
  readonly head: number;
  readonly required: number;
}

/** Confirmations = head - number + 1 (the block itself counts); final once >= required. */
export function getBlockState(input: BlockStateInput): BlockState {
  if (input.isOrphaned) return { kind: 'orphaned' };
  const confirmations = Math.max(0, input.head - input.number + 1);
  return confirmations >= input.required ? { kind: 'final' } : { kind: 'pending', confirmations };
}
