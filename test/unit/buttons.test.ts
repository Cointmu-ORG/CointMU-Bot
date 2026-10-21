import { describe, expect, it } from 'vitest';
import { Action, decodeAction, encodeAction } from '../../src/commands/callback-data.js';
import { helpText } from '../../src/commands/menus.js';
import { Admission, ReplyGate } from '../../src/commands/reply-gate.js';
import { QueueFullError, RateLimitedTelegram } from '../../src/telegram/rate-limited.js';
import { Priority, type TelegramApi } from '../../src/telegram/types.js';
import { silentLog } from '../support/harness.js';

describe('callback data', () => {
  it('round-trips actions and arguments', () => {
    expect(decodeAction(encodeAction(Action.STATUS))).toEqual({ action: 'st', arg: null });
    expect(decodeAction(encodeAction(Action.REMOVE_ADMIN, '123456789'))).toEqual({
      action: 'rm',
      arg: '123456789',
    });
  });

  it('rejects old versions, unknown actions and odd arguments', () => {
    expect(decodeAction('v0:st')).toBeNull();
    expect(decodeAction('v1:zz')).toBeNull();
    expect(decodeAction('v1:rm:1;DROP')).toBeNull();
    expect(decodeAction('v1:rm:1:2')).toBeNull();
    expect(decodeAction('')).toBeNull();
  });

  it('refuses to build callback_data over 64 bytes', () => {
    expect(() => encodeAction(Action.REMOVE_ADMIN, 'x'.repeat(70))).toThrow('too long');
  });
});

describe('ReplyGate', () => {
  const gate = (queued = 0) =>
    new ReplyGate({
      queuedReplies: () => queued,
      maxQueued: 20,
      perGroupPerMinute: 8,
      duplicateWindowMs: 10_000,
    });
  const group = { chatId: '-5', isGroup: true, viewKey: null };

  it('suppresses the same view in the same chat within the window', () => {
    const g = gate();
    const status = { ...group, viewKey: 'status' };

    expect(g.admit(status, 0)).toBe(Admission.OK);
    expect(g.admit(status, 9_999)).toBe(Admission.DUPLICATE);
    expect(g.admit({ ...status, chatId: '-6' }, 9_999)).toBe(Admission.OK);
    expect(g.admit(status, 10_000)).toBe(Admission.OK);
  });

  it('limits replies per group per minute but not in private chats', () => {
    const g = gate();
    for (let i = 0; i < 8; i += 1) expect(g.admit(group, i)).toBe(Admission.OK);

    expect(g.admit(group, 100)).toBe(Admission.BUSY);
    expect(g.admit({ chatId: '7', isGroup: false, viewKey: null }, 100)).toBe(Admission.OK);
    expect(g.admit(group, 60_001)).toBe(Admission.OK);
  });

  it('refuses when the reply queue is full', () => {
    expect(gate(20).admit(group, 0)).toBe(Admission.BUSY);
  });
});

function recordingApi(order: string[], latencyMs = 20): TelegramApi {
  return {
    sendMessage: async (chatId, html) => {
      order.push(`${chatId}:${html}`);
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      return order.length;
    },
    editMessage: () => Promise.resolve(),
    answerCallback: () => Promise.resolve(),
    setMyCommands: () => Promise.resolve(),
    deleteMyCommands: () => Promise.resolve(),
    getUpdates: () => Promise.resolve([]),
  };
}

describe('priority send queue', () => {
  it('sends alerts, then digests, before command replies queued earlier', async () => {
    const order: string[] = [];
    const queue = new RateLimitedTelegram(recordingApi(order), {
      minGapMs: 0,
      maxQueuedReplies: 20,
      log: silentLog,
    });
    const reply = { priority: Priority.REPLY };

    await Promise.all([
      queue.sendMessage('g', 'reply1', reply),
      queue.sendMessage('g', 'reply2', reply),
      queue.sendMessage('g', 'reply3', reply),
      queue.sendMessage('g', 'digest', { priority: Priority.DIGEST }),
      queue.sendMessage('a', 'alert', { priority: Priority.ALERT }),
    ]);

    // reply1 was already in flight; everything after it is strictly by priority.
    expect(order).toEqual(['g:reply1', 'a:alert', 'g:digest', 'g:reply2', 'g:reply3']);
  });

  it('applies the gap per chat, so other chats are not held up', async () => {
    const order: string[] = [];
    const sentAt = new Map<string, number>();
    const api = recordingApi(order, 0);
    const queue = new RateLimitedTelegram(
      {
        ...api,
        sendMessage: (chatId, html) => (
          sentAt.set(html, Date.now()),
          api.sendMessage(chatId, html)
        ),
      },
      { minGapMs: 200, maxQueuedReplies: 20, log: silentLog },
    );

    await Promise.all([
      queue.sendMessage('a', 'a1'),
      queue.sendMessage('a', 'a2'),
      queue.sendMessage('b', 'b1'),
    ]);

    expect(order).toEqual(['a:a1', 'b:b1', 'a:a2']);
    expect((sentAt.get('a2') ?? 0) - (sentAt.get('a1') ?? 0)).toBeGreaterThanOrEqual(190);
    expect((sentAt.get('b1') ?? 0) - (sentAt.get('a1') ?? 0)).toBeLessThan(150);
  });

  it('bounds queued replies but never digests or alerts', async () => {
    const queue = new RateLimitedTelegram(recordingApi([], 50), {
      minGapMs: 0,
      maxQueuedReplies: 2,
      log: silentLog,
    });
    const reply = { priority: Priority.REPLY };
    const accepted = [
      queue.sendMessage('g', 'r1', reply), // starts right away, no longer queued
      queue.sendMessage('g', 'r2', reply),
      queue.sendMessage('g', 'r3', reply),
    ];

    await expect(queue.sendMessage('g', 'r4', reply)).rejects.toBeInstanceOf(QueueFullError);
    expect(queue.queuedReplies()).toBe(2);
    await expect(queue.sendMessage('g', 'digest')).resolves.toBeTypeOf('number');
    await Promise.all(accepted);
  });
});

describe('help text', () => {
  const base = { chatType: 'private', canUseStats: false, hasAdmins: true } as const;

  it('shows admin help only to admins', () => {
    expect(helpText({ ...base, isAdmin: true, canUseStats: true })).toContain('/setchat');
    expect(helpText({ ...base, isAdmin: false })).not.toContain('/setchat');
  });

  it('explains the claim in a private chat while there is no admin, without any code', () => {
    const text = helpText({ ...base, isAdmin: false, hasAdmins: false });

    expect(text).toContain('/claim &lt;kode&gt;');
    expect(text).not.toMatch(/[0-9a-f]{32}/);
    expect(
      helpText({ ...base, chatType: 'group', isAdmin: false, hasAdmins: false }),
    ).not.toContain('/claim');
  });
});
