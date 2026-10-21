import type { Db } from './database.js';

export const PendingKind = {
  UNSET_CHAT: 'unsetchat',
  UNSET_ALERT: 'unsetalert',
  REMOVE_ADMIN: 'removeadmin',
  PICK_ADMIN: 'pick_admin',
} as const;
export type PendingKind = (typeof PendingKind)[keyof typeof PendingKind];

export interface PendingAction {
  readonly id: string;
  readonly kind: PendingKind;
  readonly argument: string | null;
  /** Only this user may complete or cancel the action. */
  readonly userId: string;
  readonly chatId: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
}

export interface NewPendingAction {
  readonly id: string;
  readonly kind: PendingKind;
  readonly argument: string | null;
  readonly userId: string;
  readonly chatId: string;
  readonly now: number;
  readonly ttlMs: number;
}

interface PendingRow {
  id: string;
  kind: PendingKind;
  argument: string | null;
  user_id: string;
  chat_id: string;
  expires_at: number;
  used_at: number | null;
}

/** Server-side state for two-step actions; buttons only ever carry the id. */
export class PendingActionsRepo {
  private readonly insertStmt;
  private readonly findStmt;
  private readonly consumeStmt;

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO pending_actions (id, kind, argument, user_id, chat_id, created_at, expires_at,
         updated_at) VALUES (@id, @kind, @argument, @userId, @chatId, @now, @expiresAt, @now)`,
    );
    this.findStmt = db.prepare<[string], PendingRow>(
      `SELECT id, kind, argument, user_id, chat_id, expires_at, used_at
       FROM pending_actions WHERE id = ?`,
    );
    this.consumeStmt = db.prepare(
      `UPDATE pending_actions SET used_at = @now, updated_at = @now
       WHERE id = @id AND used_at IS NULL AND expires_at > @now`,
    );
  }

  create(action: NewPendingAction): void {
    this.insertStmt.run({ ...action, expiresAt: action.now + action.ttlMs });
  }

  /** The action if it exists, is unused and has not expired at `now`. */
  findLive(id: string, now: number): PendingAction | null {
    const row = this.findStmt.get(id);
    if (!row || row.used_at !== null || row.expires_at <= now) return null;
    return {
      id: row.id,
      kind: row.kind,
      argument: row.argument,
      userId: row.user_id,
      chatId: row.chat_id,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
    };
  }

  /** Marks the action used; false if it was already used or expired (so it runs at most once). */
  consume(id: string, now: number): boolean {
    return this.consumeStmt.run({ id, now }).changes === 1;
  }
}
