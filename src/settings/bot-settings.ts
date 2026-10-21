import type { AdminsRepo } from '../db/admins-repo.js';
import type { Db } from '../db/database.js';
import { KvKey, type KvRepo } from '../db/kv-repo.js';
import type { MessagesRepo } from '../db/messages-repo.js';

export const SettingSource = {
  /** From the environment; cannot be changed from chat. */
  ENV: 'env',
  /** Set from Telegram and stored in SQLite. */
  CHAT: 'chat',
} as const;
export type SettingSource = (typeof SettingSource)[keyof typeof SettingSource];

export interface Destination {
  readonly chatId: string;
  readonly source: SettingSource;
}

export type ChangeResult = 'ok' | 'unchanged' | 'not_set' | 'locked_by_env';
export type AdminChange = 'ok' | 'already_admin' | 'not_admin' | 'env_admin' | 'last_admin';

export interface EnvSettings {
  readonly chatId: string | null;
  readonly alertChatId: string | null;
  readonly adminIds: readonly string[];
}

export interface BotSettingsDeps {
  readonly db: Db;
  readonly kv: KvRepo;
  readonly admins: AdminsRepo;
  readonly messages: MessagesRepo;
  readonly env: EnvSettings;
}

/**
 * Destinations and admins, merged from env (which always wins) and SQLite (set from chat).
 * Effective admins are the union of env admins and stored admins.
 */
export class BotSettings {
  constructor(private readonly deps: BotSettingsDeps) {}

  announceDestination(): Destination | null {
    return this.resolve(this.deps.env.chatId, KvKey.ANNOUNCE_CHAT_ID);
  }

  alertDestination(): Destination | null {
    return this.resolve(this.deps.env.alertChatId, KvKey.ALERT_CHAT_ID);
  }

  /** The alert chat, or else every admin's private chat (a private chat id equals the user id). */
  alertChatIds(): string[] {
    const destination = this.alertDestination();
    return destination ? [destination.chatId] : this.adminIds();
  }

  adminIds(): string[] {
    return [...new Set([...this.deps.env.adminIds, ...this.deps.admins.list()])];
  }

  isAdmin(userId: string): boolean {
    return this.adminIds().includes(userId);
  }

  isEnvAdmin(userId: string): boolean {
    return this.deps.env.adminIds.includes(userId);
  }

  /**
   * Sets the announcement chat. When there was none before, blocks stored meanwhile are marked
   * as sent silently so only blocks after this point are announced.
   */
  setAnnounceChat(chatId: string, now: number): { result: ChangeResult; skipped: number } {
    if (this.deps.env.chatId !== null) return { result: 'locked_by_env', skipped: 0 };
    return this.deps.db.transaction(() => {
      const current = this.deps.kv.get(KvKey.ANNOUNCE_CHAT_ID);
      if (current === chatId) return { result: 'unchanged' as const, skipped: 0 };
      const skipped = current === null ? this.deps.messages.skipUnsent(now) : 0;
      this.deps.kv.set(KvKey.ANNOUNCE_CHAT_ID, chatId, now);
      return { result: 'ok' as const, skipped };
    })();
  }

  unsetAnnounceChat(): ChangeResult {
    return this.unset(this.deps.env.chatId, KvKey.ANNOUNCE_CHAT_ID);
  }

  setAlertChat(chatId: string, now: number): ChangeResult {
    if (this.deps.env.alertChatId !== null) return 'locked_by_env';
    if (this.deps.kv.get(KvKey.ALERT_CHAT_ID) === chatId) return 'unchanged';
    this.deps.kv.set(KvKey.ALERT_CHAT_ID, chatId, now);
    return 'ok';
  }

  unsetAlertChat(): ChangeResult {
    return this.unset(this.deps.env.alertChatId, KvKey.ALERT_CHAT_ID);
  }

  addAdmin(userId: string, addedBy: string, now: number): AdminChange {
    if (this.isEnvAdmin(userId)) return 'already_admin';
    return this.deps.admins.add(userId, addedBy, now) ? 'ok' : 'already_admin';
  }

  /** Env admins can only be removed through env; the last remaining admin cannot be removed. */
  removeAdmin(userId: string): AdminChange {
    if (this.isEnvAdmin(userId)) return 'env_admin';
    if (!this.isAdmin(userId)) return 'not_admin';
    if (this.adminIds().length <= 1) return 'last_admin';
    this.deps.admins.remove(userId);
    return 'ok';
  }

  private resolve(envValue: string | null, key: KvKey): Destination | null {
    if (envValue !== null) return { chatId: envValue, source: SettingSource.ENV };
    const stored = this.deps.kv.get(key);
    return stored === null ? null : { chatId: stored, source: SettingSource.CHAT };
  }

  private unset(envValue: string | null, key: KvKey): ChangeResult {
    if (envValue !== null) return 'locked_by_env';
    return this.deps.kv.delete(key) ? 'ok' : 'not_set';
  }
}
