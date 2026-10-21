import { code } from '../render/format.js';
import { SettingSource, type BotSettings, type Destination } from '../settings/bot-settings.js';

const SOURCE_LABELS: Readonly<Record<SettingSource, string>> = {
  [SettingSource.ENV]: 'dari env',
  [SettingSource.CHAT]: 'diatur lewat chat',
};

function describeDestination(destination: Destination): string {
  return `${code(destination.chatId)} (${SOURCE_LABELS[destination.source]})`;
}

/** /chats: active destinations, admins and whether the claim code is active. */
export function renderChats(settings: BotSettings, isClaimEnabled: boolean): string {
  const announce = settings.announceDestination();
  const alert = settings.alertDestination();
  const admins = settings.adminIds();
  const adminList = admins
    .map((id) => (settings.isEnvAdmin(id) ? `${code(id)} (env)` : code(id)))
    .join(', ');
  return [
    '⚙️ <b>Pengaturan bot</b>',
    `📣 Pengumuman: ${
      announce ? describeDestination(announce) : 'belum diset (block disimpan, tidak diumumkan)'
    }`,
    `🚨 Alert: ${
      alert ? describeDestination(alert) : `chat pribadi admin (${admins.length} admin)`
    }`,
    `👤 Admin: ${adminList || 'belum ada'}`,
    `🔑 Klaim admin: ${isClaimEnabled ? 'aktif (kode ada di log bot)' : 'tidak aktif'}`,
  ].join('\n');
}
