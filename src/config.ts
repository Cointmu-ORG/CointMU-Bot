import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from './logger.js';

const DEFAULT_DB_PATH = './data/bot.db';
const DEFAULT_DRY_RUN_DB_PATH = './data/dry-run.db';
const DRY_RUN_CHAT_ID = 'dry-run';
const DRY_RUN_ALERT_CHAT_ID = 'dry-run-alerts';
const COINTMU_CHAIN_ID = 1912;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const BOT_TOKEN_PATTERN = /^\d+:[\w-]+$/;
const CHAT_ID_PATTERN = /^(-?\d+|@\w{5,})$/;
const USER_ID_PATTERN = /^\d+$/;

const int = (fallback: number, min: number) => z.coerce.number().int().min(min).default(fallback);
const decimal = (fallback: number) => z.coerce.number().min(0).default(fallback);
const idList = (pattern: RegExp) =>
  z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(pattern)));

const envSchema = z.object({
  RPC_URL: z.url({ error: 'required, e.g. http://<GETH_HOST>:<PORT>' }),
  RPC_TIMEOUT_MS: int(5_000, 100),
  EXPECTED_CHAIN_ID: int(COINTMU_CHAIN_ID, 1),
  BOT_TOKEN: z.string().regex(BOT_TOKEN_PATTERN, 'must look like 123456:ABC-xyz').optional(),
  CHAT_ID: z.string().regex(CHAT_ID_PATTERN).optional(),
  ALERT_CHAT_ID: z.string().regex(CHAT_ID_PATTERN).optional(),
  ALLOWED_USER_IDS: idList(USER_ID_PATTERN),
  ALLOWED_CHAT_IDS: idList(CHAT_ID_PATTERN),
  POLL_INTERVAL_MS: int(1_000, 100),
  SEND_INTERVAL_MS: int(10_000, 100),
  MIN_SEND_GAP_MS: int(3_000, 0),
  CONFIRMATIONS: int(6, 1),
  HASHRATE_WINDOW: int(20, 1),
  START_BACKFILL: int(50, 0),
  MIN_PEERS: int(1, 0),
  STALL_MINUTES: decimal(5),
  RPC_FAIL_THRESHOLD: int(10, 1),
  ALERT_COOLDOWN_MINUTES: decimal(10),
  HEARTBEAT_URL: z.url().optional(),
  DB_PATH: z.string().min(1).optional(),
  DRY_RUN: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  DATA_RETENTION_DAYS: int(30, 1),
  COMMAND_COOLDOWN_SECONDS: decimal(5),
  COMMAND_QUEUE_MAX: int(20, 1),
  COMMAND_REPLIES_PER_MINUTE: int(8, 1),
  DUPLICATE_WINDOW_SECONDS: decimal(10),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export interface Config {
  readonly rpcUrl: string;
  readonly rpcTimeoutMs: number;
  readonly expectedChainId: number;
  /** Null in dry-run: the bot never talks to Telegram then. */
  readonly botToken: string | null;
  /** Announcement chat from env; null means it is set from chat with /setchat. */
  readonly chatId: string | null;
  /** Alert chat from env; null means /setalert, falling back to the admins' private chats. */
  readonly alertChatId: string | null;
  /** Admins from env. They cannot be removed from chat, and they disable the claim code. */
  readonly allowedUserIds: readonly string[];
  readonly allowedChatIds: readonly string[];
  readonly pollIntervalMs: number;
  readonly sendIntervalMs: number;
  readonly minSendGapMs: number;
  readonly confirmations: number;
  readonly hashrateWindow: number;
  readonly startBackfill: number;
  readonly minPeers: number;
  /** 0 disables the stall alert (e.g. during maintenance). */
  readonly stallMs: number;
  readonly rpcFailThreshold: number;
  readonly alertCooldownMs: number;
  readonly heartbeatUrl: string | null;
  readonly dbPath: string;
  readonly isDryRun: boolean;
  readonly dataRetentionMs: number;
  /** Per-user cooldown for non-admin commands. */
  readonly commandCooldownMs: number;
  /** Most command replies waiting to be sent; more are refused ("lagi ramai"). */
  readonly commandQueueMax: number;
  /** Per group chat, so digests and status edits keep room in Telegram's ~20/min budget. */
  readonly commandRepliesPerMinute: number;
  /** The same /status, /last or /top view is not resent to a chat within this window. */
  readonly duplicateWindowMs: number;
  readonly logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Treats `KEY=` lines in .env as unset so defaults apply. */
function dropEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())),
  );
}

type ParsedEnv = z.infer<typeof envSchema>;

/**
 * Only BOT_TOKEN is required outside dry-run: chats and admins can be set from Telegram.
 * Dry-run never talks to Telegram, so it gets placeholder chats to print to.
 */
function resolveTelegram(e: ParsedEnv): Pick<Config, 'botToken' | 'chatId' | 'alertChatId'> {
  if (e.DRY_RUN) {
    return {
      botToken: null,
      chatId: e.CHAT_ID ?? DRY_RUN_CHAT_ID,
      alertChatId: e.ALERT_CHAT_ID ?? DRY_RUN_ALERT_CHAT_ID,
    };
  }
  if (!e.BOT_TOKEN) throw new ConfigError(['BOT_TOKEN: required unless DRY_RUN=true']);
  return { botToken: e.BOT_TOKEN, chatId: e.CHAT_ID ?? null, alertChatId: e.ALERT_CHAT_ID ?? null };
}

/** Parses and validates the environment once at startup; throws ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(dropEmptyValues(env));
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  return {
    rpcUrl: e.RPC_URL,
    rpcTimeoutMs: e.RPC_TIMEOUT_MS,
    expectedChainId: e.EXPECTED_CHAIN_ID,
    ...resolveTelegram(e),
    allowedUserIds: e.ALLOWED_USER_IDS,
    allowedChatIds: e.ALLOWED_CHAT_IDS,
    pollIntervalMs: e.POLL_INTERVAL_MS,
    sendIntervalMs: e.SEND_INTERVAL_MS,
    minSendGapMs: e.MIN_SEND_GAP_MS,
    confirmations: e.CONFIRMATIONS,
    hashrateWindow: e.HASHRATE_WINDOW,
    startBackfill: e.START_BACKFILL,
    minPeers: e.MIN_PEERS,
    stallMs: e.STALL_MINUTES * MS_PER_MINUTE,
    rpcFailThreshold: e.RPC_FAIL_THRESHOLD,
    alertCooldownMs: e.ALERT_COOLDOWN_MINUTES * MS_PER_MINUTE,
    heartbeatUrl: e.HEARTBEAT_URL ?? null,
    dbPath: e.DB_PATH ?? (e.DRY_RUN ? DEFAULT_DRY_RUN_DB_PATH : DEFAULT_DB_PATH),
    isDryRun: e.DRY_RUN,
    dataRetentionMs: e.DATA_RETENTION_DAYS * MS_PER_DAY,
    commandCooldownMs: e.COMMAND_COOLDOWN_SECONDS * MS_PER_SECOND,
    commandQueueMax: e.COMMAND_QUEUE_MAX,
    commandRepliesPerMinute: e.COMMAND_REPLIES_PER_MINUTE,
    duplicateWindowMs: e.DUPLICATE_WINDOW_SECONDS * MS_PER_SECOND,
    logLevel: e.LOG_LEVEL,
  };
}
