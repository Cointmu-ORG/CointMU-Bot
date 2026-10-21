import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { MockDiscord, startMockDiscord } from './mock-discord.js';
import { MockChain, startMockRpc, type RunningServer } from './mock-rpc.js';
import { MockTelegram, startMockTelegram, TEST_TOKEN } from './mock-telegram.js';

export const CHAT_ID = '-1001';
export const ALERT_CHAT_ID = '-1002';
export const ADMIN_USER_ID = '42';
export const START_TIME = Date.UTC(2026, 9, 17, 12, 0, 0);

export const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface LogEntry {
  readonly level: string;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

/** Logger that keeps every entry so tests can inspect (or check the absence of) log content. */
export function createMemoryLog(entries: LogEntry[]): Logger {
  const record =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) => {
      entries.push({ level, message, fields });
    };
  return {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
}

export function testConfig(overrides: Partial<Config> & Pick<Config, 'dbPath' | 'rpcUrl'>): Config {
  return {
    rpcTimeoutMs: 2_000,
    expectedChainId: 1912,
    botToken: TEST_TOKEN,
    chatId: CHAT_ID,
    alertChatId: ALERT_CHAT_ID,
    allowedUserIds: [ADMIN_USER_ID],
    allowedChatIds: [],
    pollIntervalMs: 100,
    sendIntervalMs: 100,
    minSendGapMs: 0,
    confirmations: 6,
    hashrateWindow: 20,
    startBackfill: 50,
    minPeers: 1,
    stallMs: 300_000,
    rpcFailThreshold: 3,
    alertCooldownMs: 600_000,
    heartbeatUrl: null,
    discordWebhookUrl: null,
    isDryRun: false,
    dataRetentionMs: 30 * 86_400_000,
    commandCooldownMs: 5_000,
    commandQueueMax: 20,
    commandRepliesPerMinute: 8,
    duplicateWindowMs: 10_000,
    logLevel: 'error',
    ...overrides,
  };
}

/**
 * Mock node + mock Telegram + mock Discord webhook + a fake clock, with apps created against a
 * temp DB. Discord is on by default, so every Telegram test also runs with Discord enabled.
 */
export class Harness {
  readonly chain = new MockChain(101);
  readonly telegram = new MockTelegram();
  readonly discord = new MockDiscord();
  readonly dir = mkdtempSync(join(tmpdir(), 'cointmu-bot-test-'));
  readonly logs: LogEntry[] = [];
  clock = START_TIME;
  private rpc: RunningServer | null = null;
  private telegramServer: RunningServer | null = null;
  private discordServer: RunningServer | null = null;
  private readonly apps: App[] = [];

  async start(): Promise<void> {
    this.rpc = await startMockRpc(this.chain);
    this.telegramServer = await startMockTelegram(this.telegram);
    this.discordServer = await startMockDiscord(this.discord);
  }

  createApp(overrides: Partial<Config> = {}): App {
    if (!this.rpc || !this.telegramServer || !this.discordServer) {
      throw new Error('harness not started');
    }
    const app = createApp(
      testConfig({
        dbPath: join(this.dir, 'bot.db'),
        rpcUrl: this.rpc.url,
        discordWebhookUrl: this.discordServer.url,
        ...overrides,
      }),
      {
        log: createMemoryLog(this.logs),
        now: () => this.clock,
        telegramBaseUrl: this.telegramServer.url,
      },
    );
    this.apps.push(app);
    return app;
  }

  /** Claim codes printed to the log, oldest first. */
  claimCodes(): string[] {
    return this.logs.flatMap((entry) =>
      typeof entry.fields.claimCode === 'string' ? [entry.fields.claimCode] : [],
    );
  }

  /** Every log line as one string, for "must not contain" assertions. */
  logText(): string {
    return this.logs.map((entry) => `${entry.message} ${JSON.stringify(entry.fields)}`).join('\n');
  }

  async stopApp(app: App): Promise<void> {
    this.apps.splice(this.apps.indexOf(app), 1);
    await app.stop();
  }

  async close(): Promise<void> {
    await Promise.all(this.apps.splice(0).map((app) => app.stop()));
    await this.rpc?.close();
    await this.telegramServer?.close();
    await this.discordServer?.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
