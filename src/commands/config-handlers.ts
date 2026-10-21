import { code } from '../render/format.js';
import type { AdminClaim } from '../settings/admin-claim.js';
import type { AdminChange, BotSettings, ChangeResult } from '../settings/bot-settings.js';
import { ChatType } from '../telegram/types.js';
import { renderChats } from './chats-view.js';
import { parseUserId } from './parse.js';
import { CommandAccess, type CommandContext, type CommandSpec } from './types.js';

const LOCKED_ANNOUNCE =
  '🔒 Tujuan pengumuman dikunci lewat CHAT_ID di env. Ubah env untuk menggantinya.';
const LOCKED_ALERT =
  '🔒 Tujuan alert dikunci lewat ALERT_CHAT_ID di env. Ubah env untuk menggantinya.';
const ONLY_GROUP_OR_PRIVATE = '⛔ /setchat hanya bisa dipakai di grup atau chat pribadi.';
const ANNOUNCE_CHAT_TYPES: readonly ChatType[] = [
  ChatType.PRIVATE,
  ChatType.GROUP,
  ChatType.SUPERGROUP,
];
const USAGE_ADD = 'Pemakaian: /addadmin <user_id> (user ID bisa dilihat dengan /id).';
const USAGE_REMOVE = 'Pemakaian: /removeadmin <user_id>';

export interface ConfigHandlerDeps {
  readonly settings: BotSettings;
  readonly claim: AdminClaim;
}

export function setChat({ settings }: ConfigHandlerDeps, { message, now }: CommandContext): string {
  if (!ANNOUNCE_CHAT_TYPES.includes(message.chatType)) return ONLY_GROUP_OR_PRIVATE;
  const { result, skipped } = settings.setAnnounceChat(message.chatId, now);
  if (result === 'locked_by_env') return LOCKED_ANNOUNCE;
  if (result === 'unchanged') return 'ℹ️ Chat ini sudah menjadi tujuan pengumuman block.';
  const skippedNote =
    skipped > 0
      ? `\n${skipped} block yang tersimpan sebelumnya ditandai terlewat (tidak diumumkan).`
      : '';
  return `✅ Chat ini sekarang menjadi tujuan pengumuman block. Hanya block baru yang diumumkan.${skippedNote}`;
}

function describeUnset(result: ChangeResult, locked: string, done: string, notSet: string): string {
  if (result === 'locked_by_env') return locked;
  return result === 'ok' ? done : notSet;
}

export function setAlert(
  { settings }: ConfigHandlerDeps,
  { message, now }: CommandContext,
): string {
  const result = settings.setAlertChat(message.chatId, now);
  if (result === 'locked_by_env') return LOCKED_ALERT;
  if (result === 'unchanged') return 'ℹ️ Chat ini sudah menjadi tujuan alert.';
  return '✅ Chat ini sekarang menjadi tujuan alert kesehatan node.';
}

const ADMIN_CHANGE_REPLIES: Readonly<
  Record<Exclude<AdminChange, 'ok'>, (userId: string) => string>
> = {
  already_admin: (id) => `ℹ️ User ${code(id)} sudah admin.`,
  not_admin: (id) => `ℹ️ User ${code(id)} bukan admin.`,
  env_admin: (id) =>
    `🔒 User ${code(id)} adalah admin dari env (ALLOWED_USER_IDS); hapus lewat env.`,
  last_admin: (id) => `⛔ User ${code(id)} adalah admin terakhir dan tidak bisa dihapus.`,
};

/** Shared by /addadmin and the user picker. */
export function addAdminReply(
  settings: BotSettings,
  userId: string,
  addedBy: string,
  now: number,
): string {
  const result = settings.addAdmin(userId, addedBy, now);
  if (result !== 'ok') return ADMIN_CHANGE_REPLIES[result](userId);
  return `✅ User ${code(userId)} sekarang admin bot.\nMinta dia membuka chat pribadi dengan bot dan kirim /start agar bisa menerima alert.`;
}

/** Shared by /removeadmin and the ❌ button (after confirmation); keeps the env/last-admin guards. */
export function removeAdminReply(settings: BotSettings, userId: string): string {
  const result = settings.removeAdmin(userId);
  return result === 'ok'
    ? `✅ User ${code(userId)} bukan admin lagi.`
    : ADMIN_CHANGE_REPLIES[result](userId);
}

export function unsetChatReply(settings: BotSettings): string {
  return describeUnset(
    settings.unsetAnnounceChat(),
    LOCKED_ANNOUNCE,
    '✅ Pengumuman dihentikan. Block tetap disimpan; /setchat untuk mengaktifkan lagi.',
    'ℹ️ Tujuan pengumuman memang belum diset.',
  );
}

export function unsetAlertReply(settings: BotSettings): string {
  return describeUnset(
    settings.unsetAlertChat(),
    LOCKED_ALERT,
    '✅ Tujuan alert dihapus. Alert kembali dikirim ke chat pribadi admin.',
    'ℹ️ Tujuan alert memang belum diset.',
  );
}

function addAdmin({ settings }: ConfigHandlerDeps, { message, args, now }: CommandContext): string {
  const userId = parseUserId(args);
  return userId === null ? USAGE_ADD : addAdminReply(settings, userId, message.fromId, now);
}

function removeAdmin({ settings }: ConfigHandlerDeps, { args }: CommandContext): string {
  const userId = parseUserId(args);
  return userId === null ? USAGE_REMOVE : removeAdminReply(settings, userId);
}

/** /setchat, /unsetchat, /setalert, /unsetalert, /chats, /addadmin, /removeadmin (admins only). */
export function createConfigCommands(deps: ConfigHandlerDeps): Record<string, CommandSpec> {
  const admin = (run: (context: CommandContext) => string): CommandSpec => ({
    access: CommandAccess.ADMIN,
    run,
  });
  return {
    setchat: admin((context) => setChat(deps, context)),
    unsetchat: admin(() => unsetChatReply(deps.settings)),
    setalert: admin((context) => setAlert(deps, context)),
    unsetalert: admin(() => unsetAlertReply(deps.settings)),
    chats: admin(() => renderChats(deps.settings, deps.claim.isEnabled())),
    addadmin: admin((context) => addAdmin(deps, context)),
    removeadmin: admin((context) => removeAdmin(deps, context)),
  };
}
