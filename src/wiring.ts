import { Collector } from './collector/collector.js';
import { NodeProbe } from './collector/node-probe.js';
import { MAX_REORG_DEPTH } from './collector/reorg.js';
import type { BotCommandsSync } from './commands/bot-commands.js';
import type { CommandPoller } from './commands/poller.js';
import { createCommands } from './commands/setup.js';
import type { Config } from './config.js';
import { createCore, type AppOverrides, type Core } from './core.js';
import { ChainWriter } from './db/chain-writer.js';
import type { BlocksRepo } from './db/blocks-repo.js';
import type { Db } from './db/database.js';
import { isCollectorHealthy } from './health/conditions.js';
import { Heartbeat } from './health/heartbeat.js';
import { renderDeepReorg } from './health/messages.js';
import { HealthMonitor } from './health/monitor.js';
import type { HealthState } from './health/state.js';
import type { Logger } from './logger.js';
import { RetentionJob } from './maintenance/retention.js';
import type { ChainReader } from './rpc/client.js';
import { Sender } from './sender/sender.js';
import { StatusUpdater } from './sender/status-updater.js';
import type { AdminClaim } from './settings/admin-claim.js';
import type { BotSettings } from './settings/bot-settings.js';
import type { RateLimitedTelegram } from './telegram/rate-limited.js';

export type { AppOverrides } from './core.js';

export interface Components {
  readonly log: Logger;
  readonly now: () => number;
  readonly db: Db;
  readonly blocks: BlocksRepo;
  readonly chain: ChainReader;
  readonly telegram: RateLimitedTelegram;
  readonly health: HealthState;
  readonly botSettings: BotSettings;
  readonly claim: AdminClaim;
  readonly collector: Collector;
  readonly probe: NodeProbe;
  readonly sender: Sender;
  readonly statusUpdater: StatusUpdater;
  readonly monitor: HealthMonitor;
  readonly heartbeat: Heartbeat | null;
  readonly retention: RetentionJob;
  readonly commands: CommandPoller | null;
  readonly commandsSync: BotCommandsSync | null;
}

function buildMonitor(core: Core): HealthMonitor {
  return new HealthMonitor({
    state: core.health,
    incidents: core.incidents,
    telegram: core.telegram,
    alertChatIds: () => core.botSettings.alertChatIds(),
    thresholds: core.thresholds,
    cooldownMs: core.config.alertCooldownMs,
    log: core.log,
    now: core.now,
  });
}

function buildCollector(core: Core, monitor: HealthMonitor): Collector {
  return new Collector({
    chain: core.chain,
    blocks: core.blocks,
    writer: new ChainWriter(core.db, core.blocks, core.config.hashrateWindow),
    health: core.health,
    startBackfill: core.config.startBackfill,
    log: core.log,
    now: core.now,
    onDeepReorg: (info) => void monitor.notify(renderDeepReorg(info)),
  });
}

function buildHeartbeat(core: Core): Heartbeat | null {
  if (core.config.heartbeatUrl === null) return null;
  const isHealthy = () => isCollectorHealthy(core.health.snapshot(), core.thresholds, core.now());
  return new Heartbeat(core.config.heartbeatUrl, isHealthy, core.log);
}

function buildRetention(core: Core): RetentionJob {
  return new RetentionJob({
    db: core.db,
    blocks: core.blocks,
    retentionMs: core.config.dataRetentionMs,
    keepRecentBlocks: Math.max(MAX_REORG_DEPTH, core.config.hashrateWindow + 1),
    isAnnouncing: () => core.botSettings.announceDestination() !== null,
    log: core.log,
    now: core.now,
  });
}

/** Builds every component of the bot without starting anything. */
export function buildComponents(config: Config, overrides: AppOverrides): Components {
  const core = createCore(config, overrides);
  const { log, db, blocks, messages, chain, telegram, health, render, now, botSettings } = core;
  const monitor = buildMonitor(core);
  const commands = createCommands(core);
  return {
    log,
    now,
    db,
    blocks,
    chain,
    telegram,
    health,
    botSettings,
    claim: core.claim,
    monitor,
    collector: buildCollector(core, monitor),
    probe: new NodeProbe(chain, health, log, now),
    sender: new Sender({
      blocks,
      messages,
      telegram,
      announceChatId: () => botSettings.announceDestination()?.chatId ?? null,
      settings: render,
      log,
      now,
    }),
    statusUpdater: new StatusUpdater({ blocks, messages, telegram, settings: render, log, now }),
    heartbeat: buildHeartbeat(core),
    retention: buildRetention(core),
    commands: commands?.poller ?? null,
    commandsSync: commands?.commandsSync ?? null,
  };
}
