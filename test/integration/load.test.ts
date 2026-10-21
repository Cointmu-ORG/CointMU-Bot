import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Toast } from '../../src/commands/replies.js';
import { ALERT_CHAT_ID, CHAT_ID, Harness } from '../support/harness.js';

const ANNOUNCE = Number(CHAT_ID);
const USERS = 30;
const FIRST_USER_ID = 1000;
const ANSWER_DEADLINE_MS = 1000;
/** Large per-chat gap so replies to the announcement chat pile up in the queue. */
const SLOW_GAP_MS = 300;

describe('30 users pressing buttons at once (mock Telegram)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    await h.close();
  });

  /** Every user presses one button in the announcement chat, all in one getUpdates batch. */
  const burst = async (app: ReturnType<Harness['createApp']>, pick: (i: number) => string) => {
    const ids = Array.from({ length: USERS }, (_, i) =>
      h.telegram.press({
        fromId: FIRST_USER_ID + i,
        chatId: ANNOUNCE,
        chatType: 'supergroup',
        messageId: 1,
        data: pick(i),
      }),
    );
    const startedAt = Date.now();
    await app.components.commands?.tick();
    return { ids, startedAt };
  };

  it('answers every press within a second and sends each view only once', async () => {
    const app = h.createApp({ minSendGapMs: SLOW_GAP_MS });
    await app.components.collector.tick();
    const views = ['v1:st', 'v1:lb', 'v1:tp'];

    const { ids, startedAt } = await burst(app, (i) => views[i % views.length] ?? 'v1:st');

    const answers = h.telegram.callsOf('answerCallbackQuery');
    expect(answers).toHaveLength(USERS);
    for (const answer of answers) expect(answer.at - startedAt).toBeLessThan(ANSWER_DEADLINE_MS);
    const toasts = ids.map((id) => h.telegram.toastFor(id));
    expect(toasts.filter((t) => t === '')).toHaveLength(views.length);
    expect(toasts.filter((t) => t === Toast.DUPLICATE)).toHaveLength(USERS - views.length);
    await app.components.commands?.settle();
    expect(h.telegram.sentTo(CHAT_ID)).toHaveLength(views.length);
  });

  it('keeps a group within its per-minute reply budget', async () => {
    const app = h.createApp({ duplicateWindowMs: 0 });
    await app.components.collector.tick();

    const { ids } = await burst(app, () => 'v1:st');
    await app.components.commands?.settle();

    const toasts = ids.map((id) => h.telegram.toastFor(id));
    expect(toasts.filter((t) => t === '')).toHaveLength(8);
    expect(toasts.filter((t) => t === Toast.BUSY)).toHaveLength(USERS - 8);
    expect(h.telegram.sentTo(CHAT_ID)).toHaveLength(8);
  });

  it('never queues more than COMMAND_QUEUE_MAX replies, and alerts and digests go first', async () => {
    const app = h.createApp({
      duplicateWindowMs: 0,
      commandRepliesPerMinute: 100,
      minSendGapMs: SLOW_GAP_MS,
      rpcFailThreshold: 1,
    });
    const c = app.components;
    await c.collector.tick();

    const { ids } = await burst(app, () => 'v1:st');
    expect(c.telegram.queuedReplies()).toBeLessThanOrEqual(20);
    const busy = ids.filter((id) => h.telegram.toastFor(id) === Toast.BUSY);
    expect(busy.length).toBeGreaterThanOrEqual(USERS - 21);

    // While ~20 replies wait for the announcement chat, a block and an outage arrive.
    h.chain.mine();
    await c.collector.tick();
    const digest = c.sender.tick();
    h.chain.isDown = true;
    await c.collector.tick();
    const alertStartedAt = Date.now();
    await c.monitor.tick();
    expect(Date.now() - alertStartedAt).toBeLessThan(ANSWER_DEADLINE_MS);
    expect(h.telegram.sentTo(ALERT_CHAT_ID)).toHaveLength(1);
    await digest;

    const toAnnouncement = h.telegram
      .callsOf('sendMessage')
      .filter((call) => call.body.chat_id === CHAT_ID);
    const digestIndex = toAnnouncement.findIndex((call) =>
      String(call.body.text).includes('Mining Reward'),
    );
    // At most the reply already in flight (plus one that took the gap slot) went before the digest.
    expect(digestIndex).toBeGreaterThanOrEqual(0);
    expect(digestIndex).toBeLessThanOrEqual(2);
    expect(c.telegram.queuedReplies()).toBeGreaterThan(10);
  });
});
