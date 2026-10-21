import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DryRunDiscord } from '../../src/discord/dry-run.js';
import { HttpDiscordWebhook } from '../../src/discord/http-client.js';
import { DiscordApiError } from '../../src/discord/types.js';
import { renderCard } from '../../src/render/card.js';
import {
  DISCORD_MAX_EMBED_CHARS,
  embedLength,
  groupForDiscord,
  renderBlockEmbed,
  renderSkippedEmbed,
  toPayload,
  type DiscordBlock,
} from '../../src/render/discord.js';

const SETTINGS = { confirmations: 6, hashrateWindow: 20 };
const HASH = `0x${'ab'.repeat(32)}`;
const PARENT = `0x${'cd'.repeat(32)}`;
const MIX = `0x${'ef'.repeat(32)}`;
const MINER = '0x3c9b08645c616ae3966252f276aa23825b3dcd85';

const block = (overrides: Partial<DiscordBlock> = {}): DiscordBlock => ({
  number: 234075,
  hash: HASH,
  parentHash: PARENT,
  miner: MINER,
  nonce: '0x63bcedf92f5600f3',
  mixHash: MIX,
  difficulty: 1_288_031n,
  status: 'canonical',
  streak: 1,
  blockTimeS: 12,
  hashrateHps: 90_140,
  isFirstForWallet: false,
  timestamp: 1_790_000_000,
  ...overrides,
});

describe('renderBlockEmbed', () => {
  it('carries the Telegram card data with full hashes and Final status', () => {
    const embed = renderBlockEmbed(block(), SETTINGS);

    expect(embed.title).toBe('🪙 Mining Reward — Block #234075');
    expect(embed.timestamp).toBe('2026-09-21T14:13:20.000Z');
    expect(embed.description).toBeUndefined();
    expect(Object.fromEntries((embed.fields ?? []).map((f) => [f.name, f.value]))).toEqual({
      '⛏️ Block': '`#234075`',
      '✅ Status': 'Final',
      '💪 Difficulty': '`1.288.031`',
      '👛 Wallet': `\`${MINER}\``,
      '🔗 Hash': `\`${HASH}\``,
      '⬅️ Prev block': `\`${PARENT}\``,
      '🎲 Nonce': '`0x63bcedf92f5600f3`',
      '⚡ Hashrate': '`≈ 90,14 kH/s` (rata-rata 20 block)',
      '🧬 MixHash': `\`${MIX}\``,
    });
  });

  it('shows the same badges as the Telegram card', () => {
    const fast = block({ isFirstForWallet: true, blockTimeS: 1 });

    const embed = renderBlockEmbed(fast, SETTINGS);

    expect(embed.description).toBe('🎉 Block pertama! · 🚀 Block time: `1 detik`');
    expect(renderCard(fast, { kind: 'final' }, SETTINGS)).toContain(
      '🚀 Block time: <code>1 detik</code>',
    );
  });

  it('summarises a skipped backlog', () => {
    const embed = renderSkippedEmbed({ count: 1234, from: 10, to: 1243 });

    expect(embed.description).toBe(
      '1.234 block (#10–#1243) tidak diposting satu per satu. Detailnya ada di Telegram.',
    );
  });
});

describe('groupForDiscord', () => {
  it('splits 23 blocks into messages of 10, 10 and 3 embeds', () => {
    const embeds = Array.from({ length: 23 }, (_, i) =>
      renderBlockEmbed(block({ number: i }), SETTINGS),
    );

    const groups = groupForDiscord(embeds, embedLength);

    expect(groups.map((group) => group.length)).toEqual([10, 10, 3]);
    expect(groups.flat()).toEqual(embeds);
  });

  it('keeps every message under 6000 embed characters', () => {
    const sizes = [2500, 2500, 2500, 100];

    const groups = groupForDiscord(sizes, (size) => size);

    expect(groups).toEqual([
      [2500, 2500],
      [2500, 100],
    ]);
    for (const group of groups) {
      expect(group.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(DISCORD_MAX_EMBED_CHARS);
    }
  });

  it('builds a payload that can never ping anyone', () => {
    expect(toPayload([])).toEqual({ embeds: [], allowed_mentions: { parse: [] } });
  });
});

interface Reply {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

describe('HttpDiscordWebhook', () => {
  const TOKEN = 'unit-secret-token';
  let close: (() => Promise<void>) | null = null;
  const requests: string[] = [];

  async function serve(reply: Reply): Promise<HttpDiscordWebhook> {
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    const { port } = server.address() as AddressInfo;
    return new HttpDiscordWebhook(`http://127.0.0.1:${port}/api/webhooks/9/${TOKEN}`);
  }

  afterEach(async () => {
    requests.length = 0;
    await close?.();
  });

  it('posts with ?wait=true and returns no wait while the bucket has room', async () => {
    const webhook = await serve({
      status: 200,
      headers: { 'x-ratelimit-remaining': '4' },
      body: {},
    });

    await expect(webhook.execute(toPayload([]))).resolves.toBe(0);
    expect(requests).toEqual([`POST /api/webhooks/9/${TOKEN}?wait=true`]);
  });

  it('returns the bucket reset time once no request is left', async () => {
    const webhook = await serve({
      status: 200,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.234' },
      body: {},
    });

    await expect(webhook.execute(toPayload([]))).resolves.toBe(1234);
  });

  it('reports a 429 with retry_after from the body', async () => {
    const webhook = await serve({
      status: 429,
      body: { message: 'You are being rate limited.', retry_after: 2.5, global: false },
    });

    const error: unknown = await webhook.execute(toPayload([])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DiscordApiError);
    expect((error as DiscordApiError).isRateLimited).toBe(true);
    expect((error as DiscordApiError).retryAfterMs).toBe(2500);
  });

  it('reports other errors without the webhook URL', async () => {
    const webhook = await serve({
      status: 400,
      body: { message: 'Invalid Form Body', code: 50035 },
    });

    const error: unknown = await webhook.execute(toPayload([])).catch((e: unknown) => e);

    expect((error as DiscordApiError).isRateLimited).toBe(false);
    expect(String(error)).toBe('DiscordApiError: discord webhook failed (400): Invalid Form Body');
    expect(String(error)).not.toContain(TOKEN);
  });
});

describe('DryRunDiscord', () => {
  it('prints the payload instead of posting it', async () => {
    const printed: string[] = [];
    const payload = toPayload([renderBlockEmbed(block(), SETTINGS)]);

    await new DryRunDiscord((text) => printed.push(text)).execute(payload);

    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('[DRY-RUN] discord webhook embeds=1');
    expect(printed[0]).toContain('"allowed_mentions": {\n    "parse": []');
    expect(printed[0]).toContain(HASH);
  });
});
