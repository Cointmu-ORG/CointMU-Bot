import { code } from '../render/format.js';
import type { BotSettings } from '../settings/bot-settings.js';
import { ChatType } from '../telegram/types.js';
import { Action, encodeAction } from './callback-data.js';
import type { Button, Screen } from './screen.js';

/** Who is looking, which decides the help text and the buttons offered. */
export interface Viewer {
  readonly isAdmin: boolean;
  readonly chatType: ChatType;
  /** Admin, or a member in the announcement chat / ALLOWED_CHAT_IDS. */
  readonly canUseStats: boolean;
  readonly hasAdmins: boolean;
}

const button = (text: string, action: Action, arg?: string): Button => ({
  text,
  data: encodeAction(action, arg),
});

export const BACK_TO_MAIN: readonly Button[] = [button('⬅️ Kembali', Action.MENU)];
export const BACK_TO_SETTINGS: readonly Button[] = [button('⬅️ Kembali', Action.SETTINGS)];

const MAIN_ROWS: readonly (readonly Button[])[] = [
  [button('📊 Status', Action.STATUS), button('🧱 Block terakhir', Action.LAST)],
  [button('🏆 Top', Action.TOP), button('❓ Bantuan', Action.HELP)],
];
const SETTINGS_BUTTON: readonly Button[] = [button('⚙️ Pengaturan', Action.SETTINGS)];

const INTRO =
  '🪙 <b>CointMU Mining Feed</b>\nBot ini mengumumkan block yang ditambang di chain CointMU dan memantau kesehatan node.';
const MEMBER_STATS_HELP =
  'Tekan tombol di bawah, atau ketik /status, /last, /top. /id menampilkan user ID dan chat ID kamu.';
const MEMBER_ELSEWHERE_HELP =
  'Statistik (/status, /last, /top) bisa dibuka di grup pengumuman. /id menampilkan user ID dan chat ID kamu.';
const ADMIN_HELP =
  '⚙️ <b>Admin</b>: tombol Pengaturan untuk tujuan pengumuman/alert dan kelola admin.\nCommand: /setchat /setalert /unsetchat /unsetalert /chats /addadmin /removeadmin';
// Explains where the code is without ever showing it.
const CLAIM_HELP =
  '🔑 Bot belum punya admin. Pemilik bot: ambil kode klaim dari log bot (cari <code>claimCode</code>), lalu kirim <code>/claim &lt;kode&gt;</code> di chat pribadi ini.';

export function helpText(viewer: Viewer): string {
  const parts = [INTRO, viewer.canUseStats ? MEMBER_STATS_HELP : MEMBER_ELSEWHERE_HELP];
  if (viewer.isAdmin) parts.push(ADMIN_HELP);
  if (!viewer.hasAdmins && viewer.chatType === ChatType.PRIVATE) parts.push(CLAIM_HELP);
  return parts.join('\n\n');
}

/** /start, /help, /menu and the ⬅️ Kembali target: help text plus the buttons this viewer may use. */
export function mainMenu(viewer: Viewer): Screen {
  const buttons = [
    ...(viewer.canUseStats ? MAIN_ROWS : []),
    ...(viewer.isAdmin ? [SETTINGS_BUTTON] : []),
  ];
  return { text: helpText(viewer), buttons };
}

export function settingsMenu(isPrivate: boolean): Screen {
  return {
    text: '⚙️ <b>Pengaturan</b>\nTombol "Jadikan chat ini…" berlaku untuk chat tempat tombol ditekan.',
    buttons: [
      [button('📍 Jadikan chat ini tujuan pengumuman', Action.SET_CHAT)],
      [button('🚨 Jadikan chat ini tujuan alert', Action.SET_ALERT)],
      [
        button('🧹 Lepas pengumuman', Action.UNSET_CHAT),
        button('🧹 Lepas alert', Action.UNSET_ALERT),
      ],
      [button('📋 Tujuan aktif', Action.CHATS), button('👥 Kelola admin', Action.ADMINS)],
      ...(isPrivate ? [BACK_TO_MAIN] : []),
    ],
  };
}

/** Admin list with a ❌ per removable admin (env admins are locked) and ➕ Tambah admin. */
export function adminsScreen(settings: BotSettings, isPrivate: boolean): Screen {
  const admins = settings.adminIds();
  const lines = admins.map((id) => `• ${code(id)}${settings.isEnvAdmin(id) ? ' 🔒 env' : ''}`);
  const removable = admins.filter((id) => !settings.isEnvAdmin(id));
  return {
    text: [
      '👥 <b>Admin bot</b>',
      ...lines,
      '',
      'Tekan ❌ untuk menghapus. Admin 🔒 dari env hanya bisa dihapus lewat env.',
    ].join('\n'),
    buttons: [
      ...removable.map((id) => [button(`❌ ${id}`, Action.REMOVE_ADMIN, id)]),
      [button('➕ Tambah admin', Action.ADD_ADMIN)],
      ...(isPrivate ? [BACK_TO_SETTINGS] : []),
    ],
  };
}

export function confirmScreen(question: string, pendingId: string): Screen {
  return {
    text: `${question}\n\nBerlaku 5 menit, hanya untuk yang menekan tombol tadi.`,
    buttons: [
      [
        button('✅ Yakin', Action.CONFIRM_YES, pendingId),
        button('↩️ Batal', Action.CONFIRM_NO, pendingId),
      ],
    ],
  };
}
