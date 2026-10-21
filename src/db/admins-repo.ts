import type { Db } from './database.js';

/** Who added an admin: the one-time claim, or the user id of the admin who ran /addadmin. */
export const CLAIM_SOURCE = 'claim';

/** Admins added from Telegram (bootstrap claim or /addadmin). Env admins are not stored here. */
export class AdminsRepo {
  private readonly listStmt;
  private readonly addStmt;
  private readonly removeStmt;

  constructor(db: Db) {
    this.listStmt = db.prepare<[], { user_id: string }>(
      'SELECT user_id FROM admins ORDER BY created_at ASC, user_id ASC',
    );
    this.addStmt = db.prepare(
      `INSERT OR IGNORE INTO admins (user_id, added_by, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.removeStmt = db.prepare('DELETE FROM admins WHERE user_id = ?');
  }

  list(): string[] {
    return this.listStmt.all().map((row) => row.user_id);
  }

  /** Returns false when the user was already stored. */
  add(userId: string, addedBy: string, now: number): boolean {
    return this.addStmt.run(userId, addedBy, now, now).changes > 0;
  }

  /** Returns false when the user was not stored. */
  remove(userId: string): boolean {
    return this.removeStmt.run(userId).changes > 0;
  }
}
