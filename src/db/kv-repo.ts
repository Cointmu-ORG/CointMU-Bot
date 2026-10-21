import type { Db } from './database.js';

export const KvKey = {
  TELEGRAM_UPDATE_OFFSET: 'telegram_update_offset',
  /** Announcement chat set with /setchat (used when CHAT_ID is not in env). */
  ANNOUNCE_CHAT_ID: 'announce_chat_id',
  /** Alert chat set with /setalert (used when ALERT_CHAT_ID is not in env). */
  ALERT_CHAT_ID: 'alert_chat_id',
  /** SHA-256 (hex) of the current one-time admin claim code; never the code itself. */
  CLAIM_CODE_HASH: 'claim_code_hash',
} as const;
export type KvKey = (typeof KvKey)[keyof typeof KvKey];

/** Small key/value store for process state that must survive restarts. */
export class KvRepo {
  private readonly getStmt;
  private readonly setStmt;
  private readonly deleteStmt;

  constructor(db: Db) {
    this.getStmt = db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?');
    this.setStmt = db.prepare(
      `INSERT INTO kv (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.deleteStmt = db.prepare('DELETE FROM kv WHERE key = ?');
  }

  get(key: KvKey): string | null {
    return this.getStmt.get(key)?.value ?? null;
  }

  set(key: KvKey, value: string, now: number): void {
    this.setStmt.run(key, value, now, now);
  }

  /** Returns whether a value was removed. */
  delete(key: KvKey): boolean {
    return this.deleteStmt.run(key).changes > 0;
  }
}
