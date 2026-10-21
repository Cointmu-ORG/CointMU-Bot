import { NODE_PROBE_INTERVAL_MS } from './collector/node-probe.js';
import type { Config } from './config.js';
import { HEARTBEAT_INTERVAL_MS } from './health/heartbeat.js';
import { HEALTH_CHECK_INTERVAL_MS } from './health/monitor.js';
import { RETENTION_INTERVAL_MS } from './maintenance/retention.js';
import { waitForExpectedChain } from './rpc/verify.js';
import { startLoop, type Loop } from './scheduler.js';
import { STATUS_UPDATE_INTERVAL_MS } from './sender/status-updater.js';
import { buildComponents, type AppOverrides, type Components } from './wiring.js';

export type { AppOverrides, Components } from './wiring.js';

/** Pause between long polls; getUpdates itself blocks up to 25 s while idle. */
const COMMAND_POLL_GAP_MS = 500;

export interface App {
  readonly components: Components;
  /**
   * Issues the admin claim code if needed and starts the monitor and commands; then verifies
   * the chain id (retrying until the node answers, counting each failure as an RPC failure so it
   * gets alerted) and starts the chain loops.
   */
  start(signal: AbortSignal): Promise<void>;
  /** Stops loops (waiting for in-flight work), then closes Telegram, RPC and the DB. */
  stop(): Promise<void>;
}

/** Loops that do not touch the chain: they run even while the node is still unreachable. */
function startEarlyLoops(c: Components): Loop[] {
  const { log, commands } = c;
  const loops = [
    startLoop('health-monitor', HEALTH_CHECK_INTERVAL_MS, () => c.monitor.tick(), log),
  ];
  if (commands) {
    loops.push(startLoop('commands', COMMAND_POLL_GAP_MS, () => commands.tick(), log));
  }
  return loops;
}

/** Loops that read the chain: started only once the node reported the expected chain id. */
function startChainLoops(c: Components, config: Config): Loop[] {
  const { log, heartbeat, discordSender } = c;
  const loops = [
    startLoop('collector', config.pollIntervalMs, () => c.collector.tick(), log),
    startLoop('node-probe', NODE_PROBE_INTERVAL_MS, () => c.probe.tick(), log),
    startLoop('sender', config.sendIntervalMs, () => c.sender.tick(), log),
    startLoop('status-updater', STATUS_UPDATE_INTERVAL_MS, () => c.statusUpdater.tick(), log),
    startLoop('retention', RETENTION_INTERVAL_MS, () => c.retention.tick(), log),
  ];
  if (heartbeat) {
    loops.push(startLoop('heartbeat', HEARTBEAT_INTERVAL_MS, () => heartbeat.tick(), log));
  }
  if (discordSender) {
    loops.push(startLoop('discord-sender', config.sendIntervalMs, () => discordSender.tick(), log));
  }
  return loops;
}

export function createApp(config: Config, overrides: AppOverrides = {}): App {
  const components = buildComponents(config, overrides);
  const loops: Loop[] = [];
  return {
    components,
    async start(signal) {
      // Before waiting for the node, so the admin can be bootstrapped even while it is down.
      if (components.commands) components.claim.issueIfNeeded();
      // Failures are logged inside; the "/" menu is cosmetic and must not delay startup.
      void components.commandsSync?.syncIfChanged();
      loops.push(...startEarlyLoops(components));
      await waitForExpectedChain(components.chain, {
        expectedChainId: config.expectedChainId,
        log: components.log,
        signal,
        onUnreachable: (error) => components.health.recordPollFailure(error, components.now()),
      });
      loops.push(...startChainLoops(components, config));
    },
    async stop() {
      components.commands?.stop();
      await Promise.all(loops.map((loop) => loop.stop()));
      components.telegram.close();
      components.chain.close();
      components.db.close();
    },
  };
}
