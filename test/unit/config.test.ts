import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';
import { createLogger, redactSecrets, registerSecret } from '../../src/logger.js';

const RPC_URL = 'http://127.0.0.1:8545';

describe('loadConfig', () => {
  it('applies the documented defaults in dry-run without Telegram settings', () => {
    const config = loadConfig({ RPC_URL, DRY_RUN: 'true' });

    expect(config).toMatchObject({
      rpcUrl: RPC_URL,
      botToken: null,
      pollIntervalMs: 1000,
      sendIntervalMs: 10_000,
      minSendGapMs: 3000,
      confirmations: 6,
      hashrateWindow: 20,
      startBackfill: 50,
      minPeers: 1,
      stallMs: 300_000,
      rpcFailThreshold: 10,
      dbPath: './data/dry-run.db',
      isDryRun: true,
    });
  });

  it('requires BOT_TOKEN outside dry-run', () => {
    expect(() => loadConfig({ RPC_URL })).toThrow(ConfigError);
  });

  it('runs with only BOT_TOKEN: chats and admins come from chat settings', () => {
    const config = loadConfig({ RPC_URL, BOT_TOKEN: '123456:abc-DEF' });

    expect(config).toMatchObject({
      chatId: null,
      alertChatId: null,
      allowedUserIds: [],
      commandCooldownMs: 5000,
      dbPath: './data/bot.db',
    });
  });

  it('treats empty values as unset and STALL_MINUTES=0 as disabled', () => {
    const config = loadConfig({
      RPC_URL,
      DRY_RUN: 'true',
      POLL_INTERVAL_MS: '',
      STALL_MINUTES: '0',
    });

    expect(config.pollIntervalMs).toBe(1000);
    expect(config.stallMs).toBe(0);
  });

  it('rejects malformed values without echoing them', () => {
    try {
      loadConfig({ RPC_URL, BOT_TOKEN: 'not-a-token-secret', CHAT_ID: '1', ALERT_CHAT_ID: '2' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain('not-a-token-secret');
    }
  });

  it.each([
    ['missing', {}],
    ['empty', { RPC_URL: '  ' }],
  ])('requires RPC_URL (%s) without echoing other values', (_label, rpc) => {
    try {
      loadConfig({ ...rpc, BOT_TOKEN: '123456:secret-token' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        'RPC_URL: required, e.g. http://<GETH_HOST>:<PORT>',
      ]);
      expect(String(error)).not.toContain('secret-token');
    }
  });

  describe('DISCORD_WEBHOOK_BLOCK_UPDATE', () => {
    const base = { RPC_URL, BOT_TOKEN: '123456:abc-DEF' };

    it('is off when empty or unset', () => {
      expect(loadConfig(base).discordWebhookUrl).toBeNull();
      expect(
        loadConfig({ ...base, DISCORD_WEBHOOK_BLOCK_UPDATE: '' }).discordWebhookUrl,
      ).toBeNull();
    });

    it.each([
      'https://discord.com/api/webhooks/123456789/AbC_def-123',
      'https://discordapp.com/api/webhooks/123456789/AbC_def-123',
      'https://discord.com/api/v10/webhooks/123456789/AbC_def-123',
    ])('accepts %s', (url) => {
      expect(loadConfig({ ...base, DISCORD_WEBHOOK_BLOCK_UPDATE: url }).discordWebhookUrl).toBe(
        url,
      );
    });

    it.each([
      'http://discord.com/api/webhooks/123456789/secret-part',
      'https://discord.com.evil.example/api/webhooks/123456789/secret-part',
      'https://evil.example/discord.com/api/webhooks/123456789/secret-part',
      'https://hooks.slack.com/services/T000/B000/secret-part',
      'https://discord.com/api/webhooks/123456789/secret-part?thread_id=1',
    ])('rejects %s without echoing it', (url) => {
      try {
        loadConfig({ ...base, DISCORD_WEBHOOK_BLOCK_UPDATE: url });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).issues).toEqual([
          'DISCORD_WEBHOOK_BLOCK_UPDATE: must be https://discord.com/api/webhooks/<id>/<token>',
        ]);
        expect(String(error)).not.toContain('secret-part');
      }
    });
  });

  it('parses id lists', () => {
    const config = loadConfig({ RPC_URL, DRY_RUN: '1', ALLOWED_USER_IDS: '1, 2,3' });

    expect(config.allowedUserIds).toEqual(['1', '2', '3']);
  });
});

describe('logger', () => {
  it('never writes a registered secret', () => {
    const lines: string[] = [];
    registerSecret('123:SECRET');
    const log = createLogger('debug', (line) => lines.push(line));

    log.error('request to https://api.telegram.org/bot123:SECRET/sendMessage failed');

    expect(lines.join('')).not.toContain('123:SECRET');
    expect(redactSecrets('x 123:SECRET y')).toBe('x [REDACTED] y');
  });
});
