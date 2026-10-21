import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_USER_ID, ALERT_CHAT_ID, CHAT_ID, Harness, waitFor } from '../support/harness.js';

describe('health alerts, commands and the running app', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    expect(h.chain.forbiddenCalls()).toEqual([]);
    await h.close();
  });

  it('alerts once when the RPC goes down and reports recovery with the duration', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();

    h.chain.isDown = true;
    for (let i = 0; i < 5; i += 1) await c.collector.tick();
    await c.monitor.tick();
    await c.monitor.tick();
    expect(h.telegram.sentTo(ALERT_CHAT_ID)).toHaveLength(1);
    expect(h.telegram.sentTo(ALERT_CHAT_ID)[0]).toContain('RPC node tidak merespons');

    h.clock += 95_000;
    h.chain.isDown = false;
    h.chain.mine();
    await c.collector.tick();
    await c.monitor.tick();

    const alerts = h.telegram.sentTo(ALERT_CHAT_ID);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toContain('✅ <b>Pulih:</b> RPC node tidak merespons');
    expect(alerts[1]).toContain('1 menit 35 detik');
    expect(h.telegram.sentTo(CHAT_ID)).toEqual([]);
  });

  it('alerts when the head stalls and recovers when a block arrives', async () => {
    const { components: c } = h.createApp({ stallMs: 60_000 });
    await c.collector.tick();
    h.clock += 61_000;
    await c.collector.tick();
    await c.monitor.tick();
    expect(h.telegram.sentTo(ALERT_CHAT_ID)[0]).toContain('Head block tidak naik');

    h.chain.mine();
    await c.collector.tick();
    await c.monitor.tick();
    expect(h.telegram.sentTo(ALERT_CHAT_ID)[1]).toContain('Pulih');
  });

  it('alerts on low peers and syncing from the node probe', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();
    h.chain.peers = 0;
    h.chain.isSyncing = true;
    await c.probe.tick();
    await c.monitor.tick();

    const alerts = h.telegram.sentTo(ALERT_CHAT_ID).join('\n');
    expect(alerts).toContain('Peer node di bawah minimum');
    expect(alerts).toContain('Node sedang syncing');
  });

  it('answers commands only for allowed users', async () => {
    const { components: c } = h.createApp();
    await c.collector.tick();
    const message = (fromId: number, text: string, updateId: number) => ({
      update_id: updateId,
      message: { chat: { id: 555, type: 'group' }, from: { id: fromId }, text },
    });
    h.telegram.pendingUpdates.push(
      message(Number(ADMIN_USER_ID), '/status', 1),
      message(7, '/status', 2),
      message(Number(ADMIN_USER_ID), '/last@CointMuBot 3', 3),
      message(Number(ADMIN_USER_ID), '/top', 4),
    );
    await c.commands?.tick();
    await c.commands?.settle();

    const replies = h.telegram.sentTo('555');
    expect(replies).toHaveLength(4);
    expect(replies[0]).toContain('Head: <code>#100</code>');
    expect(replies[1]).toContain('hanya bisa dipakai di chat pengumuman');
    expect(replies[2]).toContain('3 block terakhir');
    expect(replies[3]).toContain('24 jam terakhir');
    const lastPoll = h.telegram.calls.filter((call) => call.method === 'getUpdates').at(-1);
    expect(lastPoll?.body.offset).toBe(0);
    await c.commands?.tick();
    const nextPoll = h.telegram.calls.filter((call) => call.method === 'getUpdates').at(-1);
    expect(nextPoll?.body.offset).toBe(5);
  });

  it('runs end to end on timers and shuts down cleanly', async () => {
    const app = h.createApp();
    await app.start(new AbortController().signal);
    await waitFor(() => app.components.blocks.getTip()?.number === 100);

    h.chain.mine();
    await waitFor(() => h.telegram.sentTo(CHAT_ID).length === 1);
    await h.stopApp(app);

    expect(h.telegram.sentTo(CHAT_ID)[0]).toContain('#101');
    expect(app.components.db.open).toBe(false);
  });

  it('alerts when the node is already unreachable at startup (e.g. a wrong RPC_URL)', async () => {
    h.chain.isDown = true;
    const app = h.createApp({ rpcFailThreshold: 1 });
    const startup = new AbortController();
    const started = app.start(startup.signal).catch(() => undefined);

    // The first chain-id attempt fails at once; the monitor loop picks it up within one interval.
    await waitFor(() => h.telegram.sentTo(ALERT_CHAT_ID).length === 1, 8_000);

    expect(h.telegram.sentTo(ALERT_CHAT_ID)[0]).toContain('RPC node tidak merespons');
    expect(app.components.blocks.getTip()).toBeNull();
    startup.abort();
    await started;
  });
});
