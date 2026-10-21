import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REPLY_CLAIM_INVALID,
  REPLY_CLAIM_PRIVATE_ONLY,
} from '../../src/commands/public-handlers.js';
import { REPLY_ANONYMOUS_REJECTED, REPLY_CHANNEL_REJECTED } from '../../src/commands/replies.js';
import {
  claimAdmin,
  dm,
  GROUP_ID,
  inGroup,
  OWNER_ID,
  say,
  STRANGER_ID,
  TOKEN_ONLY,
} from '../support/chat.js';
import { Harness } from '../support/harness.js';

const GROUP = String(GROUP_ID);
const ANONYMOUS_ADMIN_BOT_ID = 1087968824;

describe('setup from chat with only BOT_TOKEN (mock Telegram)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    expect(h.chain.forbiddenCalls()).toEqual([]);
    await h.close();
  });

  it('collects but announces nothing until /setchat, then only new blocks', async () => {
    const app = h.createApp(TOKEN_ONLY);
    const c = app.components;
    await c.collector.tick();
    h.chain.mine();
    h.chain.mine();
    await c.collector.tick();
    await c.sender.tick();
    expect(h.telegram.calls.filter((call) => call.method === 'sendMessage')).toEqual([]);
    expect(c.blocks.getTip()?.number).toBe(102);

    await claimAdmin(h, app);
    const [reply] = await inGroup(h, app, OWNER_ID, '/setchat');
    expect(reply).toContain('sekarang menjadi tujuan pengumuman');
    expect(reply).toContain('2 block');
    await c.sender.tick();
    expect(h.telegram.sentTo(GROUP)).toHaveLength(1);

    h.chain.mine();
    await c.collector.tick();
    await c.sender.tick();
    const announcements = h.telegram.sentTo(GROUP).slice(1);
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toContain('⛏️ Block: <code>#103</code>');
    expect(announcements[0]).not.toContain('#101');
  });

  it('/id answers anyone with only their user id and chat id', async () => {
    const app = h.createApp(TOKEN_ONLY);

    const [reply] = await inGroup(h, app, STRANGER_ID, '/id');

    expect(reply).toBe(
      `🆔 User ID: <code>${STRANGER_ID}</code>\n💬 Chat ID: <code>${GROUP}</code>`,
    );
  });

  it('treats a /claim posted in a group as leaked: burns it and logs a new one', async () => {
    const app = h.createApp(TOKEN_ONLY);
    app.components.claim.issueIfNeeded();
    const [leaked = ''] = h.claimCodes();
    const logCountBefore = h.logs.length;

    const [reply] = await inGroup(h, app, STRANGER_ID, `/claim ${leaked}`);

    expect(reply).toBe(REPLY_CLAIM_PRIVATE_ONLY);
    expect(reply).not.toContain(leaked);
    const [, fresh = ''] = h.claimCodes();
    expect(fresh).not.toBe(leaked);
    const laterLogs = h.logs.slice(logCountBefore);
    expect(JSON.stringify(laterLogs)).not.toContain(leaked);
    expect(await dm(h, app, OWNER_ID, `/claim ${leaked}`)).toEqual([REPLY_CLAIM_INVALID]);
    h.clock += 5_000;
    expect((await dm(h, app, OWNER_ID, `/claim ${fresh}`))[0]).toContain('sekarang admin');
  });

  it('rejects commands from a channel and from anonymous senders with a clear reply', async () => {
    const app = h.createApp(TOKEN_ONLY);

    const channelReplies = await say(h, app, {
      chatId: -900,
      chatType: 'channel',
      text: '/setchat',
    });
    const anonymousReplies = await say(h, app, {
      chatId: GROUP_ID,
      chatType: 'supergroup',
      fromId: ANONYMOUS_ADMIN_BOT_ID,
      senderChatId: GROUP_ID,
      text: '/setchat',
    });

    expect(channelReplies).toEqual([REPLY_CHANNEL_REJECTED]);
    expect(anonymousReplies).toEqual([REPLY_ANONYMOUS_REJECTED]);
    expect(app.components.botSettings.announceDestination()).toBeNull();
  });

  it('sends alerts to the admin privately until /setalert, then to that chat', async () => {
    const app = h.createApp(TOKEN_ONLY);
    const c = app.components;
    await c.collector.tick();
    h.chain.isDown = true;
    for (let i = 0; i < 3; i += 1) await c.collector.tick();
    await c.monitor.tick();
    expect(h.telegram.calls.filter((call) => call.method === 'sendMessage')).toEqual([]);

    await claimAdmin(h, app);
    await c.monitor.tick();
    expect(h.telegram.sentTo(String(OWNER_ID)).at(-1)).toContain('RPC node tidak merespons');

    const [setReply] = await inGroup(h, app, OWNER_ID, '/setalert', -700);
    expect(setReply).toContain('tujuan alert');
    h.chain.isDown = false;
    await c.collector.tick();
    await c.monitor.tick();
    expect(h.telegram.sentTo('-700').at(-1)).toContain('Pulih');

    const [unsetReply] = await inGroup(h, app, OWNER_ID, '/unsetalert', -700);
    expect(unsetReply).toContain('chat pribadi admin');
    expect(c.botSettings.alertChatIds()).toEqual([String(OWNER_ID)]);
  });

  it('refuses /setchat when CHAT_ID comes from env', async () => {
    const app = h.createApp({ chatId: '-1001', allowedUserIds: ['42'] });

    const [reply] = await inGroup(h, app, 42, '/setchat');

    expect(reply).toContain('dikunci lewat CHAT_ID');
    expect(app.components.botSettings.announceDestination()?.chatId).toBe('-1001');
  });
});
