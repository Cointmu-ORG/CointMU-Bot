import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_SEPARATOR } from '../../src/render/card.js';
import { CHAT_ID, Harness } from '../support/harness.js';
import { MINER_B } from '../support/mock-rpc.js';

const TOO_MANY_REQUESTS = {
  ok: false,
  error_code: 429,
  description: 'Too Many Requests: retry after 1',
  parameters: { retry_after: 1 },
};

describe('announcements (mock RPC + mock Telegram)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    expect(h.chain.forbiddenCalls()).toEqual([]);
    await h.close();
  });

  it('seeds silently, then announces a new block and edits it once when final', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();
    await c.sender.tick();
    expect(h.telegram.sentTo(CHAT_ID)).toEqual([]);

    h.chain.mine(MINER_B);
    await c.collector.tick();
    await c.sender.tick();
    const [announcement] = h.telegram.sentTo(CHAT_ID);
    expect(announcement).toContain('⛏️ Block: <code>#101</code>');
    expect(announcement).toContain(`👛 Wallet: <code>${MINER_B}</code>`);
    expect(announcement).toContain('🎉 Block pertama!');
    expect(announcement).toContain('<code>1/6</code> konfirmasi');

    for (let i = 0; i < 4; i += 1) h.chain.mine();
    await c.collector.tick();
    await c.statusUpdater.tick();
    expect(h.telegram.editsCount()).toBe(0);

    h.chain.mine();
    await c.collector.tick();
    await c.statusUpdater.tick();
    await c.statusUpdater.tick();
    expect(h.telegram.editsCount()).toBe(1);
    const edit = h.telegram.calls.find((call) => call.method === 'editMessageText');
    expect(String(edit?.body.text)).toContain('✅ Status: Final');
  });

  it('bundles three blocks mined within 5 seconds into one ascending digest', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();
    h.chain.mine(undefined, 1);
    h.chain.mine(undefined, 2);
    h.chain.mine(undefined, 2);
    await c.collector.tick();
    await c.sender.tick();

    const messages = h.telegram.sentTo(CHAT_ID);
    expect(messages).toHaveLength(1);
    const cards = (messages[0] ?? '').split(CARD_SEPARATOR);
    expect(cards.map((card) => /#(\d+)/.exec(card)?.[1])).toEqual(['101', '102', '103']);
    expect(cards[0]).toContain('🚀 Block time: <code>1 detik</code>');
  });

  it('marks reorged blocks as orphaned, edits their message and announces the new branch', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();
    h.chain.mine();
    h.chain.mine();
    h.chain.mine();
    await c.collector.tick();
    await c.sender.tick();

    h.chain.reorg(2, 3);
    await c.collector.tick();
    await c.statusUpdater.tick();
    await c.sender.tick();

    const edit = h.telegram.calls.find((call) => call.method === 'editMessageText');
    const editedText = String(edit?.body.text);
    expect(editedText.match(/❌ Status: Reorg \(block kalah\)/g)).toHaveLength(2);
    const [, newBranch] = h.telegram.sentTo(CHAT_ID);
    expect(newBranch?.split(CARD_SEPARATOR).map((card) => /#(\d+)/.exec(card)?.[1])).toEqual([
      '102',
      '103',
      '104',
    ]);
    expect(c.blocks.getCanonical(103)?.hash).toBe(h.chain.blocks[103]?.hash);
    expect(c.blocks.getTip()?.number).toBe(104);
  });

  it('resumes after a restart without duplicating or losing blocks', async () => {
    const first = h.createApp();
    await first.components.collector.tick();
    h.chain.mine();
    h.chain.mine();
    await first.components.collector.tick();
    await first.components.sender.tick();
    h.chain.mine();
    h.chain.mine();
    await first.components.collector.tick();
    await h.stopApp(first);

    h.chain.mine();
    const second = h.createApp();
    await second.components.collector.tick();
    await second.components.sender.tick();

    const announced = h.telegram
      .sentTo(CHAT_ID)
      .flatMap((text) => [...text.matchAll(/Block: <code>#(\d+)<\/code>/g)].map((m) => m[1]));
    expect(announced).toEqual(['101', '102', '103', '104', '105']);
  });

  it('waits retry_after on HTTP 429 and sends the digest exactly once', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();
    h.chain.mine();
    await c.collector.tick();
    h.telegram.failNext('sendMessage', 429, TOO_MANY_REQUESTS);

    const startedAt = Date.now();
    await c.sender.tick();
    await c.sender.tick();

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(990);
    expect(h.telegram.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(2);
    expect(h.telegram.sentTo(CHAT_ID)).toHaveLength(1);
    expect(c.blocks.getCanonical(101)?.isSent).toBe(true);
  });
});
