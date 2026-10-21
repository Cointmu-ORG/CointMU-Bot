import { describe, expect, it } from 'vitest';
import { Cooldown } from '../../src/commands/cooldown.js';
import { parseCommand, parseUserId } from '../../src/commands/parse.js';
import { parseUpdates } from '../../src/telegram/updates.js';

describe('parseUpdates', () => {
  it('maps messages, channel posts and anonymous senders', () => {
    const updates = parseUpdates([
      { update_id: 1, message: { chat: { id: -5, type: 'group' }, from: { id: 7 }, text: '/id' } },
      { update_id: 2, channel_post: { chat: { id: -9, type: 'channel' }, text: '/status' } },
      {
        update_id: 3,
        message: {
          chat: { id: -5, type: 'supergroup' },
          from: { id: 1087968824 },
          sender_chat: { id: -5 },
          text: '/setchat',
        },
      },
    ]);

    expect(updates.map((u) => u.message)).toEqual([
      {
        chatId: '-5',
        chatType: 'group',
        fromId: '7',
        isAnonymous: false,
        text: '/id',
        sharedUsers: null,
      },
      {
        chatId: '-9',
        chatType: 'channel',
        fromId: null,
        isAnonymous: false,
        text: '/status',
        sharedUsers: null,
      },
      {
        chatId: '-5',
        chatType: 'supergroup',
        fromId: '1087968824',
        isAnonymous: true,
        text: '/setchat',
        sharedUsers: null,
      },
    ]);
  });

  it('keeps malformed updates (to advance the offset) without a message', () => {
    const updates = parseUpdates([{ update_id: 4, message: { chat: 'broken' } }, { nope: true }]);

    expect(updates).toEqual([{ updateId: 4, message: null, callback: null }]);
  });

  it('maps callback queries and users_shared', () => {
    const [press, shared] = parseUpdates([
      {
        update_id: 5,
        callback_query: {
          id: 'cb1',
          from: { id: 7 },
          message: { message_id: 42, chat: { id: -5, type: 'supergroup' } },
          data: 'v1:st',
        },
      },
      {
        update_id: 6,
        message: {
          chat: { id: 7, type: 'private' },
          from: { id: 7 },
          users_shared: { request_id: 99, users: [{ user_id: 123 }] },
        },
      },
    ]);

    expect(press?.callback).toEqual({
      id: 'cb1',
      fromId: '7',
      chatId: '-5',
      chatType: 'supergroup',
      messageId: 42,
      data: 'v1:st',
    });
    expect(shared?.message?.sharedUsers).toEqual({ requestId: 99, userIds: ['123'] });
  });

  it('keeps a callback whose message is no longer accessible, without chat', () => {
    const [update] = parseUpdates([
      { update_id: 7, callback_query: { id: 'cb2', from: { id: 7 }, data: 'v1:st' } },
    ]);

    expect(update?.callback?.chatId).toBeNull();
    expect(update?.callback?.messageId).toBeNull();
  });
});

describe('command parsing', () => {
  it('strips the bot username and keeps arguments', () => {
    expect(parseCommand('/addadmin@CointMuBot 123')).toEqual({ name: 'addadmin', args: '123' });
    expect(parseCommand('hello')).toBeNull();
  });

  it('accepts only numeric user ids', () => {
    expect(parseUserId('123456')).toBe('123456');
    expect(parseUserId('@someone')).toBeNull();
    expect(parseUserId('')).toBeNull();
  });
});

describe('Cooldown', () => {
  it('allows one command per user per window', () => {
    const cooldown = new Cooldown(5_000);

    expect(cooldown.tryAcquire('1', 0)).toBe(true);
    expect(cooldown.tryAcquire('1', 4_999)).toBe(false);
    expect(cooldown.tryAcquire('2', 4_999)).toBe(true);
    expect(cooldown.tryAcquire('1', 5_000)).toBe(true);
  });
});
