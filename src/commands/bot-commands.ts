import { describeError, type Logger } from '../logger.js';
import type { BotSettings } from '../settings/bot-settings.js';
import type { BotCommand, CommandScope, TelegramApi } from '../telegram/types.js';

const BASE: readonly BotCommand[] = [
  { command: 'start', description: 'Buka menu' },
  { command: 'help', description: 'Bantuan' },
  { command: 'menu', description: 'Menu tombol' },
  { command: 'id', description: 'Lihat user ID dan chat ID' },
];
const STATS: readonly BotCommand[] = [
  { command: 'status', description: 'Status node dan chain' },
  { command: 'last', description: 'Block terakhir, mis. /last 5' },
  { command: 'top', description: 'Peringkat wallet' },
];
const ADMIN: readonly BotCommand[] = [
  { command: 'setchat', description: 'Jadikan chat ini tujuan pengumuman' },
  { command: 'unsetchat', description: 'Lepas tujuan pengumuman' },
  { command: 'setalert', description: 'Jadikan chat ini tujuan alert' },
  { command: 'unsetalert', description: 'Lepas tujuan alert' },
  { command: 'chats', description: 'Tujuan aktif' },
  { command: 'addadmin', description: 'Tambah admin: /addadmin <user_id>' },
  { command: 'removeadmin', description: 'Hapus admin: /removeadmin <user_id>' },
];

export const PRIVATE_COMMANDS = BASE;
export const GROUP_COMMANDS = [...BASE, ...STATS];
export const ADMIN_COMMANDS = [...BASE, ...STATS, ...ADMIN];

/**
 * Keeps Telegram's "/" menu in step with roles: the basic list in private chats, the basic list
 * plus stats in every group, and the full list only in each admin's private chat.
 * ponytail: the synced admin set is in memory, so a scope left by an admin removed while the bot
 * was down stays until Telegram drops it; harmless, every command is still checked server side.
 */
export class BotCommandsSync {
  private syncedAdmins: ReadonlySet<string> | null = null;

  constructor(
    private readonly telegram: TelegramApi,
    private readonly settings: BotSettings,
    private readonly log: Logger,
  ) {}

  /** Cheap when nothing changed; failures are logged and retried on the next admin change. */
  async syncIfChanged(): Promise<void> {
    const admins = new Set(this.settings.adminIds());
    const previous = this.syncedAdmins;
    if (previous && isSameSet(previous, admins)) return;
    this.syncedAdmins = admins;
    if (!previous) await this.syncSharedScopes();
    for (const id of admins) {
      if (!previous?.has(id)) {
        await this.apply(() => this.telegram.setMyCommands(ADMIN_COMMANDS, chatScope(id)));
      }
    }
    for (const id of previous ?? []) {
      if (!admins.has(id)) await this.apply(() => this.telegram.deleteMyCommands(chatScope(id)));
    }
  }

  private async syncSharedScopes(): Promise<void> {
    await this.apply(() => this.telegram.setMyCommands(PRIVATE_COMMANDS, { type: 'default' }));
    await this.apply(() =>
      this.telegram.setMyCommands(GROUP_COMMANDS, { type: 'all_group_chats' }),
    );
  }

  private async apply(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (error) {
      this.log.warn('setMyCommands failed', { error: describeError(error) });
    }
  }
}

function isSameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** A private chat's id equals the user's id. */
function chatScope(userId: string): CommandScope {
  return { type: 'chat', chat_id: userId };
}
