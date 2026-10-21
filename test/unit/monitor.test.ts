import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/db/database.js';
import { IncidentsRepo } from '../../src/db/incidents-repo.js';
import { SamplesRepo } from '../../src/db/samples-repo.js';
import { assessHealth } from '../../src/health/conditions.js';
import { HealthMonitor } from '../../src/health/monitor.js';
import { HealthState } from '../../src/health/state.js';
import type { TelegramApi } from '../../src/telegram/types.js';
import { silentLog } from '../support/harness.js';

const THRESHOLDS = { rpcFailThreshold: 3, stallMs: 60_000, minPeers: 1 };
const COOLDOWN_MS = 600_000;

describe('assessHealth', () => {
  const snapshot = {
    consecutiveFailures: 0,
    lastError: null,
    lastHead: 10,
    lastHeadChangeAt: 0,
    lastPollOkAt: 0,
    peers: 1,
    isSyncing: false,
  };

  it('reports nothing for a healthy node', () => {
    expect(assessHealth(snapshot, THRESHOLDS, 1000).problems).toEqual([]);
  });

  it('detects stall, low peers and syncing together', () => {
    const kinds = assessHealth(
      { ...snapshot, peers: 0, isSyncing: true },
      THRESHOLDS,
      60_000,
    ).problems.map((p) => p.kind);

    expect(kinds).toEqual(['stalled', 'low_peers', 'syncing']);
  });

  it('does not report a stall when STALL_MINUTES is 0', () => {
    const result = assessHealth(snapshot, { ...THRESHOLDS, stallMs: 0 }, 10_000_000);

    expect(result.problems).toEqual([]);
  });

  it('reports only rpc_down while the node is unreachable', () => {
    const result = assessHealth({ ...snapshot, consecutiveFailures: 3, peers: 0 }, THRESHOLDS, 1e9);

    expect(result.problems.map((p) => p.kind)).toEqual(['rpc_down']);
    expect([...result.evaluatedKinds]).toEqual(['rpc_down']);
  });
});

describe('HealthMonitor', () => {
  let db: Db;
  let clock: number;
  let sent: string[];
  let state: HealthState;
  let monitor: HealthMonitor;

  beforeEach(() => {
    db = openDatabase(':memory:');
    clock = 0;
    sent = [];
    const telegram: TelegramApi = {
      sendMessage: (_chat, html) => Promise.resolve(sent.push(html)),
      editMessage: () => Promise.resolve(),
      answerCallback: () => Promise.resolve(),
      setMyCommands: () => Promise.resolve(),
      deleteMyCommands: () => Promise.resolve(),
      getUpdates: () => Promise.resolve([]),
    };
    state = new HealthState(new SamplesRepo(db), clock);
    monitor = new HealthMonitor({
      state,
      incidents: new IncidentsRepo(db),
      telegram,
      alertChatIds: () => ['alerts'],
      thresholds: THRESHOLDS,
      cooldownMs: COOLDOWN_MS,
      log: silentLog,
      now: () => clock,
    });
  });

  afterEach(() => db.close());

  const failPolls = (count: number) => {
    for (let i = 0; i < count; i += 1) state.recordPollFailure(new Error('ECONNREFUSED'), clock);
  };

  it('alerts once per incident and reports recovery with the duration', async () => {
    failPolls(3);
    await monitor.tick();
    await monitor.tick();
    clock = 125_000;
    state.recordPollSuccess(11, clock);
    await monitor.tick();
    await monitor.tick();

    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('RPC node tidak merespons');
    expect(sent[1]).toContain('Pulih');
    expect(sent[1]).toContain('2 menit 5 detik');
  });

  it('stays silent for a flap within the cooldown, but alerts if it outlasts it', async () => {
    failPolls(3);
    await monitor.tick();
    clock = 10_000;
    state.recordPollSuccess(11, clock);
    await monitor.tick();
    expect(sent).toHaveLength(2);

    clock = 20_000;
    failPolls(3);
    await monitor.tick();
    expect(sent).toHaveLength(2);

    clock = 10_000 + COOLDOWN_MS;
    await monitor.tick();
    expect(sent).toHaveLength(3);
    expect(sent[2]).toContain('RPC node tidak merespons');
  });

  it('sends no recovery for an incident that never alerted', async () => {
    failPolls(3);
    await monitor.tick();
    clock = 10_000;
    state.recordPollSuccess(11, clock);
    await monitor.tick();
    clock = 20_000;
    failPolls(3);
    await monitor.tick();
    clock = 30_000;
    state.recordPollSuccess(12, clock);
    await monitor.tick();

    expect(sent).toHaveLength(2);
  });
});
