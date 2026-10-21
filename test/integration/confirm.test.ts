import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GROUP_COMMANDS, PRIVATE_COMMANDS } from '../../src/commands/bot-commands.js';
import { Toast } from '../../src/commands/replies.js';
import {
  buttonData,
  claimAdmin,
  dm,
  GROUP_ID,
  inGroup,
  OWNER_ID,
  press,
  TOKEN_ONLY,
} from '../support/chat.js';
import { Harness } from '../support/harness.js';
import type { RecordedCall } from '../support/mock-telegram.js';

const SECOND_ADMIN = 88;
const MEMBER = 9;
const FIVE_MINUTES_MS = 5 * 60_000;

/** The pending-action id carried by the "Yakin" button of a confirmation message. */
function confirmId(call: RecordedCall | undefined): string {
  const yes = buttonData(call).find((data) => data.startsWith('v1:y:'));
  if (!yes) throw new Error('no confirmation buttons');
  return yes.slice('v1:y:'.length);
}

describe('confirmations, admin management and the "/" menu (mock Telegram)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    await h.close();
  });

  const groupPress = (
    app: ReturnType<Harness['createApp']>,
    fromId: number,
    data: string,
    messageId = 1,
  ) => press(h, app, { fromId, chatId: GROUP_ID, chatType: 'group', messageId, data });

  it('asks before unsetting; only the initiator may answer; the result edits the prompt', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);
    await dm(h, app, OWNER_ID, `/addadmin ${SECOND_ADMIN}`);
    await inGroup(h, app, OWNER_ID, '/setchat');
    const settings = app.components.botSettings;

    const ask = await groupPress(app, OWNER_ID, 'v1:uc');
    expect(ask.sent).toHaveLength(1);
    const id = confirmId(ask.sent[0]);
    expect(id.length).toBeLessThanOrEqual(16);
    expect(settings.announceDestination()).not.toBeNull();

    expect((await groupPress(app, MEMBER, `v1:y:${id}`)).toast).toBe(Toast.NOT_YOURS);
    expect((await groupPress(app, SECOND_ADMIN, `v1:y:${id}`)).toast).toBe(Toast.NOT_YOURS);

    const cancel = await groupPress(app, OWNER_ID, `v1:n:${id}`, 321);
    expect(cancel.sent).toEqual([]);
    expect(cancel.edited.map((call) => call.body.message_id)).toEqual([321]);
    expect(String(cancel.edited[0]?.body.text)).toContain('Dibatalkan');
    expect((await groupPress(app, OWNER_ID, `v1:y:${id}`)).toast).toBe(Toast.EXPIRED);
    expect(settings.announceDestination()).not.toBeNull();

    const id2 = confirmId((await groupPress(app, OWNER_ID, 'v1:uc')).sent[0]);
    const done = await groupPress(app, OWNER_ID, `v1:y:${id2}`, 654);
    expect(done.sent).toEqual([]);
    expect(String(done.edited[0]?.body.text)).toContain('Pengumuman dihentikan');
    expect(settings.announceDestination()).toBeNull();
  });

  it('expires a confirmation after 5 minutes of server time', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);
    await dm(h, app, OWNER_ID, '/setalert');
    const privatePress = (data: string) =>
      press(h, app, { fromId: OWNER_ID, chatId: OWNER_ID, chatType: 'private', data });

    const id = confirmId((await privatePress('v1:ua')).edited[0]);
    h.clock += FIVE_MINUTES_MS;

    expect((await privatePress(`v1:y:${id}`)).toast).toBe(Toast.EXPIRED);
    expect(app.components.botSettings.alertDestination()).not.toBeNull();
  });

  it('re-checks admin rights when Yakin is pressed', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);
    await dm(h, app, OWNER_ID, `/addadmin ${SECOND_ADMIN}`);
    await inGroup(h, app, OWNER_ID, '/setchat');
    const id = confirmId((await groupPress(app, SECOND_ADMIN, 'v1:uc')).sent[0]);

    await dm(h, app, OWNER_ID, `/removeadmin ${SECOND_ADMIN}`);
    const result = await groupPress(app, SECOND_ADMIN, `v1:y:${id}`);

    expect(result.toast).toBe(Toast.ADMIN_ONLY);
    expect(app.components.botSettings.announceDestination()).not.toBeNull();
  });

  it('manages admins with ❌ buttons, keeping env admins and the last admin', async () => {
    const app = h.createApp({ ...TOKEN_ONLY, allowedUserIds: ['42'] });
    await dm(h, app, 42, `/addadmin ${OWNER_ID}`);
    const privatePress = (data: string) =>
      press(h, app, { fromId: 42, chatId: 42, chatType: 'private', data });

    const list = buttonData((await privatePress('v1:ad')).edited[0]);
    expect(list).toContain(`v1:rm:${OWNER_ID}`);
    expect(list).not.toContain('v1:rm:42');

    const forged = confirmId((await privatePress('v1:rm:42')).edited[0]);
    expect(String((await privatePress(`v1:y:${forged}`)).edited[0]?.body.text)).toContain(
      'hapus lewat env',
    );

    const id = confirmId((await privatePress(`v1:rm:${OWNER_ID}`)).edited[0]);
    expect(String((await privatePress(`v1:y:${id}`)).edited[0]?.body.text)).toContain(
      'bukan admin lagi',
    );
    expect(app.components.botSettings.adminIds()).toEqual(['42']);
  });

  it('refuses to remove the last admin from the buttons too', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);
    const privatePress = (data: string) =>
      press(h, app, { fromId: OWNER_ID, chatId: OWNER_ID, chatType: 'private', data });

    const id = confirmId((await privatePress(`v1:rm:${OWNER_ID}`)).edited[0]);

    expect(String((await privatePress(`v1:y:${id}`)).edited[0]?.body.text)).toContain(
      'admin terakhir',
    );
    expect(app.components.botSettings.adminIds()).toEqual([String(OWNER_ID)]);
  });

  it('adds an admin with the Telegram user picker (users_shared)', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);
    const share = async (fromId: number, requestId: number, userId: number) => {
      const before = h.telegram.sentTo(String(fromId)).length;
      h.telegram.shareUsers({ fromId, requestId, userIds: [userId] });
      await app.components.commands?.tick();
      await app.components.commands?.settle();
      return h.telegram.sentTo(String(fromId)).slice(before);
    };
    const startPicker = async () => {
      const result = await press(h, app, {
        fromId: OWNER_ID,
        chatId: OWNER_ID,
        chatType: 'private',
        data: 'v1:aa',
      });
      const markup = result.sent[0]?.body.reply_markup as {
        keyboard: { request_users: { request_id: number; user_is_bot: boolean } }[][];
      };
      return markup.keyboard[0]?.[0]?.request_users;
    };

    const request = await startPicker();
    expect(request?.user_is_bot).toBe(false);
    const requestId = request?.request_id ?? 0;
    expect(await share(OWNER_ID, requestId + 1, 555)).toEqual([
      expect.stringContaining('kedaluwarsa'),
    ]);
    expect(await share(MEMBER, requestId, 556)).toEqual([expect.stringContaining('khusus admin')]);
    expect(await share(OWNER_ID, requestId, 555)).toEqual([
      expect.stringContaining('sekarang admin'),
    ]);
    expect(h.telegram.callsOf('sendMessage').at(-1)?.body.reply_markup).toEqual({
      remove_keyboard: true,
    });
    expect(await share(OWNER_ID, requestId, 557)).toEqual([expect.stringContaining('kedaluwarsa')]);

    const late = (await startPicker())?.request_id ?? 0;
    h.clock += FIVE_MINUTES_MS;
    expect(await share(OWNER_ID, late, 558)).toEqual([expect.stringContaining('kedaluwarsa')]);
    expect(app.components.botSettings.adminIds().sort()).toEqual(['555', String(OWNER_ID)]);

    const inGroupPress = await groupPress(app, OWNER_ID, 'v1:aa');
    expect(inGroupPress.toast).toBe(Toast.PRIVATE_ONLY);
  });

  it('registers the "/" menu per scope: full admin list only in admin private chats', async () => {
    const app = h.createApp(TOKEN_ONLY);
    const scopeCalls = () =>
      [...h.telegram.callsOf('setMyCommands'), ...h.telegram.callsOf('deleteMyCommands')].map(
        (call) => ({
          method: call.method,
          scope: call.body.scope,
          commands: (call.body.commands as { command: string }[] | undefined)?.map(
            (c) => c.command,
          ),
        }),
      );

    await app.components.commandsSync?.syncIfChanged();
    expect(scopeCalls()).toEqual([
      {
        method: 'setMyCommands',
        scope: { type: 'default' },
        commands: PRIVATE_COMMANDS.map((c) => c.command),
      },
      {
        method: 'setMyCommands',
        scope: { type: 'all_group_chats' },
        commands: GROUP_COMMANDS.map((c) => c.command),
      },
    ]);
    expect(GROUP_COMMANDS.map((c) => c.command)).not.toContain('setchat');

    await claimAdmin(h, app);
    await dm(h, app, OWNER_ID, `/addadmin ${SECOND_ADMIN}`);
    await dm(h, app, OWNER_ID, `/removeadmin ${SECOND_ADMIN}`);

    const later = scopeCalls().slice(2);
    expect(later.map((call) => [call.method, call.scope])).toEqual([
      ['setMyCommands', { type: 'chat', chat_id: String(OWNER_ID) }],
      ['setMyCommands', { type: 'chat', chat_id: String(SECOND_ADMIN) }],
      ['deleteMyCommands', { type: 'chat', chat_id: String(SECOND_ADMIN) }],
    ]);
    expect(later[0]?.commands).toContain('setchat');
  });
});
