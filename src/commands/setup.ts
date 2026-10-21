import type { Core } from '../core.js';
import { PendingActionsRepo } from '../db/pending-actions-repo.js';
import { StatsRepo } from '../db/stats-repo.js';
import { AccessPolicy } from './access.js';
import { AdminPicker } from './admin-picker.js';
import { BotCommandsSync } from './bot-commands.js';
import { createButtonActions } from './button-actions.js';
import { CallbackRouter } from './callbacks.js';
import { createConfigCommands } from './config-handlers.js';
import { ConfirmFlow } from './confirmations.js';
import { Cooldown } from './cooldown.js';
import { createMenuCommands } from './menu-commands.js';
import { CommandPoller } from './poller.js';
import { createPublicCommands } from './public-handlers.js';
import { ReplyGate } from './reply-gate.js';
import { CommandRouter } from './router.js';
import { createStatsCommands } from './stats-handlers.js';
import type { CommandTable } from './types.js';

function createCommandTable(core: Core, policy: AccessPolicy): CommandTable {
  return {
    ...createMenuCommands(policy, core.botSettings),
    ...createPublicCommands(core.claim),
    ...createStatsCommands({
      blocks: core.blocks,
      stats: new StatsRepo(core.db),
      incidents: core.incidents,
      health: core.health,
      render: core.render,
      sessionStartedAt: core.now(),
    }),
    ...createConfigCommands({ settings: core.botSettings, claim: core.claim }),
  };
}

export interface CommandsBundle {
  readonly poller: CommandPoller;
  readonly commandsSync: BotCommandsSync;
}

/** Commands and buttons need the real Bot API, so there are none in dry-run. */
export function createCommands(core: Core): CommandsBundle | null {
  if (core.config.botToken === null) return null;
  const { botSettings: settings, telegram, log, config } = core;
  const policy = new AccessPolicy({
    settings,
    cooldown: new Cooldown(config.commandCooldownMs),
    allowedChatIds: config.allowedChatIds,
  });
  const commands = createCommandTable(core, policy);
  const pending = new PendingActionsRepo(core.db);
  const confirm = new ConfirmFlow(pending, settings);
  const picker = new AdminPicker(pending, settings);
  const gate = new ReplyGate({
    queuedReplies: () => telegram.queuedReplies(),
    maxQueued: config.commandQueueMax,
    perGroupPerMinute: config.commandRepliesPerMinute,
    duplicateWindowMs: config.duplicateWindowMs,
  });
  const actions = createButtonActions({
    policy,
    settings,
    claim: core.claim,
    confirm,
    picker,
    commands,
  });
  const commandsSync = new BotCommandsSync(telegram, settings, log);
  const poller = new CommandPoller({
    telegram,
    kv: core.kv,
    router: new CommandRouter({ commands, policy, log }),
    callbacks: new CallbackRouter({ actions, policy, gate, confirm, log }),
    picker,
    gate,
    commandsSync,
    log,
    now: core.now,
  });
  return { poller, commandsSync };
}
