import { describe, expect, it } from 'vitest';
import {
  CARD_SEPARATOR,
  maxCardLength,
  renderCard,
  renderDigest,
  type CardBlock,
} from '../../src/render/card.js';
import {
  groupCards,
  OversizedCardError,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from '../../src/render/split.js';

const settings = { confirmations: 6, hashrateWindow: 20 };
const HASH = `0x${'ab'.repeat(32)}`;
const PARENT = `0x${'cd'.repeat(32)}`;
const MIX = `0x${'ef'.repeat(32)}`;

function block(overrides: Partial<CardBlock> = {}): CardBlock {
  return {
    number: 232_458,
    hash: HASH,
    parentHash: PARENT,
    miner: '0x3c9b08645c616ae3966252f276aa23825b3dcd85',
    nonce: '0x36d53405cdac8e8a',
    mixHash: MIX,
    difficulty: 1_169_998n,
    status: 'canonical',
    streak: 1,
    blockTimeS: 12,
    hashrateHps: 81_234,
    isFirstForWallet: false,
    ...overrides,
  };
}

describe('renderCard', () => {
  it('renders every field as "Label: value" with values in <code>', () => {
    const text = renderCard(block(), { kind: 'pending', confirmations: 2 }, settings);

    expect(text.split('\n')).toEqual([
      '🪙 Mining Reward 🪙',
      '⛏️ Block: <code>#232458</code>',
      '👛 Wallet: <code>0x3c9b08645c616ae3966252f276aa23825b3dcd85</code>',
      `🔗 Hash: <code>${HASH}</code>`,
      `⬅️ Prev block: <code>${PARENT}</code>`,
      '🎲 Nonce: <code>0x36d53405cdac8e8a</code>',
      `🧬 MixHash: <code>${MIX}</code>`,
      '💪 Difficulty: <code>1.169.998</code>',
      '⚡ Hashrate: <code>≈ 81,23 kH/s</code> (rata-rata 20 block)',
      '⏳ Status: <code>2/6</code> konfirmasi',
    ]);
  });

  it('renders final and orphaned status lines', () => {
    expect(renderCard(block(), { kind: 'final' }, settings)).toContain('✅ Status: Final');
    expect(renderCard(block(), { kind: 'orphaned' }, settings)).toContain(
      '❌ Status: Reorg (block kalah)',
    );
  });

  it('escapes hostile values', () => {
    const text = renderCard(block({ miner: '<script>&' }), { kind: 'final' }, settings);

    expect(text).toContain('<code>&lt;script&gt;&amp;</code>');
    expect(text).not.toContain('<script>');
  });

  it('shows n/a when the hashrate is unknown', () => {
    const text = renderCard(block({ hashrateHps: null }), { kind: 'final' }, settings);

    expect(text).toContain('⚡ Hashrate: <code>n/a</code>');
  });

  it('adds badges for first block, streak milestones and fast/slow blocks', () => {
    const render = (b: CardBlock) => renderCard(b, { kind: 'final' }, settings);

    expect(render(block({ isFirstForWallet: true }))).toContain('🎉 Block pertama!');
    expect(render(block({ streak: 20 }))).toContain('🔥 Streak: <code>x20</code>');
    expect(render(block({ streak: 11 }))).not.toContain('🔥');
    expect(render(block({ blockTimeS: 2 }))).toContain('🚀 Block time: <code>2 detik</code>');
    expect(render(block({ blockTimeS: 75 }))).toContain('🐢 Block time: <code>75 detik</code>');
    expect(render(block({ blockTimeS: 30 }))).not.toMatch(/🚀|🐢/);
  });
});

describe('renderDigest', () => {
  it('orders cards as given and computes each status from the head', () => {
    const text = renderDigest([block({ number: 10 }), block({ number: 12 })], 15, settings);
    const [first, second] = text.split(CARD_SEPARATOR);

    expect(first).toContain('#10');
    expect(first).toContain('✅ Status: Final');
    expect(second).toContain('#12');
    expect(second).toContain('<code>4/6</code>');
  });
});

describe('groupCards', () => {
  it('splits between cards so every message fits the Telegram limit', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => block({ number: i }));

    const groups = groupCards(blocks, (b) => maxCardLength(b, settings), CARD_SEPARATOR.length);

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat()).toEqual(blocks);
    for (const group of groups) {
      for (const state of ['final', 'orphaned'] as const) {
        const text = group
          .map((b) => renderCard(b, { kind: state }, settings))
          .join(CARD_SEPARATOR);
        expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
      }
    }
  });

  it('puts everything in one group when it fits', () => {
    expect(groupCards([1, 2, 3], () => 10, 2, 100)).toEqual([[1, 2, 3]]);
  });

  it('splits exactly at the boundary', () => {
    // 10 + 2 + 10 = 22 fits in 22; adding another would need 34.
    expect(groupCards([1, 2, 3], () => 10, 2, 22)).toEqual([[1, 2], [3]]);
  });

  it('rejects a single card that can never fit', () => {
    expect(() => groupCards([1], () => 5000, 2)).toThrow(OversizedCardError);
  });
});
