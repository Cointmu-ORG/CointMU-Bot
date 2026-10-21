import type { Config } from './config.js';
import { AdminsRepo } from './db/admins-repo.js';
import { BlocksRepo } from './db/blocks-repo.js';
import { openDatabase, type Db } from './db/database.js';
import { IncidentsRepo } from './db/incidents-repo.js';
import { KvRepo } from './db/kv-repo.js';
import { MessagesRepo } from './db/messages-repo.js';
import { SamplesRepo } from './db/samples-repo.js';
import type { HealthThresholds } from './health/conditions.js';
import { HealthState } from './health/state.js';
import { createLogger, type Logger } from './logger.js';
import type { RenderSettings } from './render/card.js';
import {
  createChainReader,
  createEthersTransport,
  type ChainReader,
  type RpcTransport,
} from './rpc/client.js';
import { AdminClaim } from './settings/admin-claim.js';
import { BotSettings } from './settings/bot-settings.js';
import { DryRunTelegram } from './telegram/dry-run.js';
import { HttpTelegramApi } from './telegram/http-client.js';
import { RateLimitedTelegram } from './telegram/rate-limited.js';
import type { TelegramApi } from './telegram/types.js';

/** Injection points for tests; production uses the defaults. */
export interface AppOverrides {
  readonly log?: Logger;
  readonly now?: () => number;
  readonly transport?: RpcTransport;
  readonly telegramBaseUrl?: string;
  readonly dryRunPrint?: (text: string) => void;
}

/** Shared infrastructure every component is built from. */
export interface Core {
  readonly config: Config;
  readonly log: Logger;
  readonly now: () => number;
  readonly db: Db;
  readonly kv: KvRepo;
  readonly blocks: BlocksRepo;
  readonly messages: MessagesRepo;
  readonly incidents: IncidentsRepo;
  readonly health: HealthState;
  readonly chain: ChainReader;
  readonly telegram: RateLimitedTelegram;
  /** Destinations and admins (env + SQLite). */
  readonly botSettings: BotSettings;
  readonly claim: AdminClaim;
  readonly render: RenderSettings;
  readonly thresholds: HealthThresholds;
}

function createTelegram(config: Config, overrides: AppOverrides): TelegramApi {
  if (config.botToken === null) return new DryRunTelegram(overrides.dryRunPrint);
  return new HttpTelegramApi({ token: config.botToken, baseUrl: overrides.telegramBaseUrl });
}

function createBotSettings(config: Config, db: Db, kv: KvRepo): BotSettings {
  return new BotSettings({
    db,
    kv,
    admins: new AdminsRepo(db),
    messages: new MessagesRepo(db),
    env: {
      chatId: config.chatId,
      alertChatId: config.alertChatId,
      adminIds: config.allowedUserIds,
    },
  });
}

export function createCore(config: Config, overrides: AppOverrides): Core {
  const now = overrides.now ?? Date.now;
  const log = overrides.log ?? createLogger(config.logLevel);
  const db = openDatabase(config.dbPath);
  const kv = new KvRepo(db);
  const botSettings = createBotSettings(config, db, kv);
  const transport =
    overrides.transport ??
    createEthersTransport({
      url: config.rpcUrl,
      timeoutMs: config.rpcTimeoutMs,
      chainId: config.expectedChainId,
    });
  return {
    config,
    log,
    now,
    db,
    kv,
    blocks: new BlocksRepo(db),
    messages: new MessagesRepo(db),
    incidents: new IncidentsRepo(db),
    health: new HealthState(new SamplesRepo(db), now()),
    chain: createChainReader(transport),
    telegram: new RateLimitedTelegram(createTelegram(config, overrides), {
      minGapMs: config.isDryRun ? 0 : config.minSendGapMs,
      maxQueuedReplies: config.commandQueueMax,
      log,
    }),
    botSettings,
    claim: new AdminClaim({ db, kv, settings: botSettings, log, now }),
    render: { confirmations: config.confirmations, hashrateWindow: config.hashrateWindow },
    thresholds: {
      rpcFailThreshold: config.rpcFailThreshold,
      stallMs: config.stallMs,
      minPeers: config.minPeers,
    },
  };
}
