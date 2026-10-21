import { BlockStatus, type StoredBlock } from '../domain/block.js';
import { getBlockState, type BlockState } from '../stats/confirmations.js';
import { code, formatHashrate, formatThousands } from './format.js';

export const CARD_SEPARATOR = '\n\n';
const FAST_BLOCK_SECONDS = 3;
const SLOW_BLOCK_SECONDS = 60;
const STREAK_MILESTONE = 10;

export interface RenderSettings {
  readonly confirmations: number;
  readonly hashrateWindow: number;
}

export type CardBlock = Pick<
  StoredBlock,
  | 'number'
  | 'hash'
  | 'parentHash'
  | 'miner'
  | 'nonce'
  | 'mixHash'
  | 'difficulty'
  | 'status'
  | 'streak'
  | 'blockTimeS'
  | 'hashrateHps'
  | 'isFirstForWallet'
>;

function renderStatus(state: BlockState, required: number): string {
  switch (state.kind) {
    case 'final':
      return '✅ Status: Final';
    case 'orphaned':
      return '❌ Status: Reorg (block kalah)';
    case 'pending':
      return `⏳ Status: ${code(`${state.confirmations}/${required}`)} konfirmasi`;
  }
}

/** Bonus lines for a card; `format` marks up values (Telegram <code>, Discord backticks). */
export function renderBadges(block: CardBlock, format: (value: string) => string): string[] {
  const badges: string[] = [];
  if (block.isFirstForWallet) badges.push('🎉 Block pertama!');
  if (block.streak >= STREAK_MILESTONE && block.streak % STREAK_MILESTONE === 0) {
    badges.push(`🔥 Streak: ${format(`x${block.streak}`)}`);
  }
  if (block.blockTimeS !== null && block.blockTimeS < FAST_BLOCK_SECONDS) {
    badges.push(`🚀 Block time: ${format(`${block.blockTimeS} detik`)}`);
  }
  if (block.blockTimeS !== null && block.blockTimeS > SLOW_BLOCK_SECONDS) {
    badges.push(`🐢 Block time: ${format(`${block.blockTimeS} detik`)}`);
  }
  return badges;
}

/** One announcement card in Telegram HTML; every dynamic value is escaped inside <code>. */
export function renderCard(block: CardBlock, state: BlockState, settings: RenderSettings): string {
  const hashrate = block.hashrateHps === null ? 'n/a' : `≈ ${formatHashrate(block.hashrateHps)}`;
  return [
    '🪙 Mining Reward 🪙',
    `⛏️ Block: ${code(`#${block.number}`)}`,
    `👛 Wallet: ${code(block.miner)}`,
    `🔗 Hash: ${code(block.hash)}`,
    `⬅️ Prev block: ${code(block.parentHash)}`,
    `🎲 Nonce: ${code(block.nonce)}`,
    `🧬 MixHash: ${code(block.mixHash)}`,
    `💪 Difficulty: ${code(formatThousands(block.difficulty))}`,
    `⚡ Hashrate: ${code(hashrate)} (rata-rata ${settings.hashrateWindow} block)`,
    renderStatus(state, settings.confirmations),
    ...renderBadges(block, code),
  ].join('\n');
}

export function stateOf(block: CardBlock, head: number, settings: RenderSettings): BlockState {
  return getBlockState({
    number: block.number,
    isOrphaned: block.status === BlockStatus.ORPHANED,
    head,
    required: settings.confirmations,
  });
}

/** Full message text for the given blocks (ascending) at the given canonical head. */
export function renderDigest(
  blocks: readonly CardBlock[],
  head: number,
  settings: RenderSettings,
): string {
  return blocks
    .map((block) => renderCard(block, stateOf(block, head, settings), settings))
    .join(CARD_SEPARATOR);
}

/**
 * Upper bound of a card's length in any state (the orphaned status line is the longest),
 * so a later edit can never push a message past Telegram's limit.
 */
export function maxCardLength(block: CardBlock, settings: RenderSettings): number {
  const states: BlockState[] = [
    { kind: 'orphaned' },
    { kind: 'final' },
    { kind: 'pending', confirmations: settings.confirmations },
  ];
  return Math.max(...states.map((state) => renderCard(block, state, settings).length));
}
