import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { DISCORD_BACKLOG_MAX_BLOCKS } from '../../src/sender/discord-sender.js';
import { CHAT_ID, Harness } from '../support/harness.js';
import { DISCORD_TEST_TOKEN } from '../support/mock-discord.js';

/** testConfig uses CONFIRMATIONS=6: a block is final once 5 more are mined on top. */
const BLOCKS_ON_TOP_FOR_FINAL = 5;
/** MockChain(101): the seed stores 0..100, so the first announced block is 101. */
const FIRST_NEW_BLOCK = 101;
const BACKOFF_BASE_MS = 10_000;

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Mines `count` blocks that will be final, plus the blocks on top that make them final. */
function mineFinal(h: Harness, count: number): void {
  for (let i = 0; i < count + BLOCKS_ON_TOP_FOR_FINAL; i += 1) h.chain.mine();
}

async function seed(app: App): Promise<void> {
  await app.components.collector.tick();
}

async function tickDiscord(app: App): Promise<void> {
  await app.components.discordSender?.tick();
}

function telegramBlocks(h: Harness): string[] {
  return h.telegram
    .sentTo(CHAT_ID)
    .flatMap((text) => [...text.matchAll(/Block: <code>#(\d+)<\/code>/g)].map((m) => m[1] ?? ''));
}

describe('Discord #block-update (mock RPC + mock Telegram + mock Discord)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    expect(h.chain.forbiddenCalls()).toEqual([]);
    await h.close();
  });

  it('posts only final blocks, at most 10 embeds per message, with no mentions', async () => {
    const app = h.createApp();
    await seed(app);
    mineFinal(h, 12);
    await app.components.collector.tick();

    await tickDiscord(app);

    const posts = h.discord.accepted();
    expect(posts.map((post) => post.embeds.length)).toEqual([10, 2]);
    expect(h.discord.postedBlocks()).toEqual(range(FIRST_NEW_BLOCK, FIRST_NEW_BLOCK + 11));
    for (const post of posts) {
      expect(post.allowed_mentions).toEqual({ parse: [] });
      expect(post.content).toBeUndefined();
    }
    const fields = posts[0]?.embeds[0]?.fields?.map((f) => f.name);
    expect(fields).toEqual([
      '⛏️ Block',
      '✅ Status',
      '💪 Difficulty',
      '👛 Wallet',
      '🔗 Hash',
      '⬅️ Prev block',
      '🎲 Nonce',
      '⚡ Hashrate',
      '🧬 MixHash',
    ]);
  });

  it('does not change what Telegram sends', async () => {
    const run = async (discordWebhookUrl?: null) => {
      const harness = new Harness();
      await harness.start();
      const app = harness.createApp(discordWebhookUrl === null ? { discordWebhookUrl } : {});
      await seed(app);
      mineFinal(harness, 3);
      await app.components.collector.tick();
      await app.components.sender.tick();
      await tickDiscord(app);
      const sent = harness.telegram.sentTo(CHAT_ID);
      const discordPosts = harness.discord.accepted().length;
      await harness.close();
      return { sent, discordPosts };
    };

    const withDiscord = await run();
    const withoutDiscord = await run(null);

    expect(withDiscord.discordPosts).toBe(1);
    expect(withoutDiscord.discordPosts).toBe(0);
    expect(withDiscord.sent).toEqual(withoutDiscord.sent);
  });

  it('waits retry_after on HTTP 429 and then posts every block exactly once', async () => {
    const app = h.createApp();
    await seed(app);
    mineFinal(h, 3);
    await app.components.collector.tick();
    h.discord.failNext(429, { message: 'You are being rate limited.', retry_after: 1.5 });

    await tickDiscord(app);
    h.clock += 1_000;
    await tickDiscord(app);
    const attemptsWhilePaused = h.discord.posts.length;
    h.clock += 500;
    await tickDiscord(app);

    expect(attemptsWhilePaused).toBe(1);
    expect(h.discord.posts.map((post) => post.isAccepted)).toEqual([false, true]);
    expect(h.discord.postedBlocks()).toEqual(range(FIRST_NEW_BLOCK, FIRST_NEW_BLOCK + 2));
  });

  it('keeps Telegram going while Discord is down, then catches up without duplicates', async () => {
    const app = h.createApp();
    await seed(app);
    h.discord.isDown = true;
    mineFinal(h, 4);
    await app.components.collector.tick();

    await app.components.sender.tick();
    await tickDiscord(app);
    h.clock += BACKOFF_BASE_MS / 2;
    await tickDiscord(app);

    expect(telegramBlocks(h)).toHaveLength(4 + BLOCKS_ON_TOP_FOR_FINAL);
    expect(h.discord.posts).toHaveLength(1);
    expect(h.discord.accepted()).toEqual([]);

    h.discord.isDown = false;
    h.clock += BACKOFF_BASE_MS / 2;
    await tickDiscord(app);
    await tickDiscord(app);

    expect(h.discord.postedBlocks()).toEqual(range(FIRST_NEW_BLOCK, FIRST_NEW_BLOCK + 3));
    expect(h.logs.some((entry) => entry.message === 'discord recovered')).toBe(true);
    expect(h.logText()).not.toContain(DISCORD_TEST_TOKEN);
  });

  it('resumes after a restart without posting a block twice or skipping one', async () => {
    const first = h.createApp();
    await seed(first);
    mineFinal(h, 3);
    await first.components.collector.tick();
    await first.components.sender.tick();
    await tickDiscord(first);
    h.chain.mine();
    h.chain.mine();
    await first.components.collector.tick();
    h.discord.failNext(429, { message: 'You are being rate limited.', retry_after: 30 });
    await tickDiscord(first);
    await h.stopApp(first);

    h.chain.mine();
    const second = h.createApp();
    await second.components.collector.tick();
    await second.components.sender.tick();
    await tickDiscord(second);

    // 101..103 went out before the restart; 104..105 hit a 429. Head 111 now: up to 106 final.
    expect(h.discord.postedBlocks()).toEqual(range(FIRST_NEW_BLOCK, 106));
    expect(telegramBlocks(h)).toEqual(range(FIRST_NEW_BLOCK, 111).map(String));
  });

  it('collapses a backlog over the cap into one summary and posts the newest blocks', async () => {
    const app = h.createApp();
    await seed(app);
    const backlog = DISCORD_BACKLOG_MAX_BLOCKS + 50;
    h.discord.isDown = true;
    mineFinal(h, backlog);
    await app.components.collector.tick();
    await tickDiscord(app);
    h.discord.isDown = false;
    h.clock += BACKOFF_BASE_MS;

    await tickDiscord(app);

    const [summary, ...batches] = h.discord.accepted();
    expect(summary?.embeds).toHaveLength(1);
    expect(summary?.embeds[0]?.title).toBe('⏩ Discord tertinggal');
    expect(summary?.embeds[0]?.description).toContain('50 block (#101–#150)');
    expect(batches).toHaveLength(DISCORD_BACKLOG_MAX_BLOCKS / 10);
    expect(h.discord.postedBlocks()).toEqual(range(151, 150 + DISCORD_BACKLOG_MAX_BLOCKS));
  });

  it('does nothing when no webhook is set, and never posts those blocks later', async () => {
    const off = h.createApp({ discordWebhookUrl: null });
    expect(off.components.discordSender).toBeNull();
    await seed(off);
    mineFinal(h, 2);
    await off.components.collector.tick();
    await h.stopApp(off);

    mineFinal(h, 1);
    const on = h.createApp();
    await on.components.collector.tick();
    await tickDiscord(on);

    // Blocks stored while Discord was off are skipped; the first new one is 108.
    expect(h.discord.postedBlocks()).toEqual([108]);
  });
});
