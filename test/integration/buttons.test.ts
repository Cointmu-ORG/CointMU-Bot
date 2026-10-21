import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Toast } from '../../src/commands/replies.js';
import { buttonData, claimAdmin, dm, inGroup, press, say, TOKEN_ONLY } from '../support/chat.js';
import { Harness } from '../support/harness.js';

const ANNOUNCE = -1001; // CHAT_ID in the test config
const ADMIN = 42; // ALLOWED_USER_IDS in the test config
const MEMBER = 9;
const MAIN = ['v1:st', 'v1:lb', 'v1:tp', 'v1:h'];
const MENU_MESSAGE_ID = 555;

describe('menus and buttons (mock Telegram)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    await h.close();
  });

  const sentButtons = async (reply: Promise<string[]>) => {
    await reply;
    return buttonData(h.telegram.callsOf('sendMessage').at(-1));
  };

  it('shows a role-specific menu for /start, /help and /menu', async () => {
    const app = h.createApp();
    await app.components.collector.tick();

    expect(await sentButtons(dm(h, app, ADMIN, '/start'))).toEqual([...MAIN, 'v1:s']);
    expect(await sentButtons(inGroup(h, app, MEMBER, '/help', ANNOUNCE))).toEqual(MAIN);
    expect(await sentButtons(inGroup(h, app, ADMIN, '/menu', ANNOUNCE))).toEqual([...MAIN, 'v1:s']);
    h.clock += 5_000;
    expect(await sentButtons(dm(h, app, MEMBER, '/start'))).toEqual([]);
    h.clock += 5_000;
    expect(await sentButtons(inGroup(h, app, MEMBER, '/menu', -777))).toEqual([]);
    expect(h.telegram.sentTo(String(MEMBER)).at(-1)).not.toContain('/setchat');
  });

  it('explains the claim privately while there is no admin, never showing the code', async () => {
    const app = h.createApp(TOKEN_ONLY);
    app.components.claim.issueIfNeeded();
    const [code = ''] = h.claimCodes();

    const [privateHelp = ''] = await dm(h, app, MEMBER, '/help');
    h.clock += 5_000;
    const [groupHelp = ''] = await inGroup(h, app, MEMBER, '/help');

    expect(privateHelp).toContain('/claim');
    expect(privateHelp).not.toContain(code);
    expect(groupHelp).not.toContain('/claim');
  });

  it('private chat: every button edits the same message and offers ⬅️ Kembali', async () => {
    const app = h.createApp();
    await app.components.collector.tick();

    for (const data of [
      'v1:st',
      'v1:lb',
      'v1:tp',
      'v1:h',
      'v1:s',
      'v1:sc',
      'v1:sa',
      'v1:ch',
      'v1:ad',
    ]) {
      const result = await press(h, app, {
        fromId: ADMIN,
        chatId: ADMIN,
        chatType: 'private',
        messageId: MENU_MESSAGE_ID,
        data,
      });
      expect(result.toast, data).toBe('');
      expect(result.sent, data).toEqual([]);
      expect(
        result.edited.map((call) => call.body.message_id),
        data,
      ).toEqual([MENU_MESSAGE_ID]);
      const buttons = buttonData(result.edited[0]);
      expect(buttons.includes('v1:m') || buttons.includes('v1:s'), data).toBe(true);
    }
  });

  it('group: a button posts a new message and never edits the shared menu', async () => {
    const app = h.createApp();
    await app.components.collector.tick();

    const result = await press(h, app, {
      fromId: MEMBER,
      chatId: ANNOUNCE,
      chatType: 'supergroup',
      data: 'v1:st',
    });

    expect(result.toast).toBe('');
    expect(result.edited).toEqual([]);
    expect(result.sent).toHaveLength(1);
    expect(String(result.sent[0]?.body.text)).toContain('Status CointMU');
    expect(buttonData(result.sent[0])).toEqual([]);
  });

  it('non-admins pressing admin buttons get a toast and nothing is posted', async () => {
    const app = h.createApp({ commandCooldownMs: 0 });

    for (const data of [
      'v1:s',
      'v1:sc',
      'v1:sa',
      'v1:uc',
      'v1:ua',
      'v1:ch',
      'v1:ad',
      'v1:rm:42',
      'v1:aa',
    ]) {
      const result = await press(h, app, {
        fromId: MEMBER,
        chatId: ANNOUNCE,
        chatType: 'group',
        data,
      });
      expect(result.toast, data).toBe(Toast.ADMIN_ONLY);
      expect([...result.sent, ...result.edited], data).toEqual([]);
    }
    expect(app.components.botSettings.announceDestination()?.chatId).toBe(String(ANNOUNCE));
  });

  it('members may not use the menu in private chats', async () => {
    const app = h.createApp();

    const result = await press(h, app, {
      fromId: MEMBER,
      chatId: MEMBER,
      chatType: 'private',
      data: 'v1:st',
    });

    expect(result.toast).toBe(Toast.STATS_DENIED);
    expect([...result.sent, ...result.edited]).toEqual([]);
  });

  it('applies the per-user cooldown to button presses', async () => {
    const app = h.createApp();
    await app.components.collector.tick();
    const group = { fromId: MEMBER, chatId: ANNOUNCE, chatType: 'group' } as const;

    expect((await press(h, app, { ...group, data: 'v1:st' })).toast).toBe('');
    const tooSoon = await press(h, app, { ...group, data: 'v1:lb' });
    h.clock += 5_000;
    const later = await press(h, app, { ...group, data: 'v1:lb' });

    expect(tooSoon.toast).toBe(Toast.COOLDOWN);
    expect(tooSoon.sent).toEqual([]);
    expect(later.toast).toBe('');
    expect(later.sent).toHaveLength(1);
  });

  it('does not repost a view just shown in the same chat', async () => {
    const app = h.createApp();
    await app.components.collector.tick();

    await press(h, app, { fromId: MEMBER, chatId: ANNOUNCE, chatType: 'group', data: 'v1:st' });
    const again = await press(h, app, {
      fromId: 10,
      chatId: ANNOUNCE,
      chatType: 'group',
      data: 'v1:st',
    });

    expect(again.toast).toBe(Toast.DUPLICATE);
    expect(again.sent).toEqual([]);
  });

  it('answers old, unknown or forged callbacks with "kedaluwarsa"', async () => {
    const app = h.createApp();

    for (const data of ['v0:st', 'v1:zz', 'garbage', 'v1:y:nope', 'v1:rm:abc']) {
      const result = await press(h, app, {
        fromId: ADMIN,
        chatId: ADMIN,
        chatType: 'private',
        data,
      });
      expect(result.toast, data).toBe(Toast.EXPIRED);
      expect([...result.sent, ...result.edited], data).toEqual([]);
    }
    h.telegram.pendingUpdates.push({
      update_id: 900,
      callback_query: { id: 'gone', from: { id: ADMIN }, data: 'v1:st' },
    });
    await app.components.commands?.tick();
    expect(h.telegram.toastFor('gone')).toBe(Toast.EXPIRED);
  });

  it('sends a new message when the pressed message can no longer be edited', async () => {
    const app = h.createApp();
    await app.components.collector.tick();
    h.telegram.failNext('editMessageText', 400, {
      ok: false,
      error_code: 400,
      description: 'Bad Request: message to edit not found',
    });

    const result = await press(h, app, {
      fromId: ADMIN,
      chatId: ADMIN,
      chatType: 'private',
      data: 'v1:st',
    });

    expect(result.sent).toHaveLength(1);
    expect(String(result.sent[0]?.body.text)).toContain('Status CointMU');
  });

  it('keeps typed commands working next to the buttons', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);

    expect(
      (await say(h, app, { chatId: -5, chatType: 'group', fromId: 77, text: '/setchat' }))[0],
    ).toContain('tujuan pengumuman');
    expect((await dm(h, app, 77, '/chats'))[0]).toContain('Pengaturan bot');
  });
});
