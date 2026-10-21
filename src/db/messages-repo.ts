import { BlockStatus } from '../domain/block.js';
import type { Db } from './database.js';

export interface StoredMessage {
  readonly id: number;
  readonly chatId: string;
  readonly telegramMessageId: number;
  readonly lastRenderedText: string;
  readonly editedOrphanCount: number;
  readonly isSettled: boolean;
}

interface MessageRow {
  id: number;
  chat_id: string;
  telegram_message_id: number;
  last_rendered_text: string;
  edited_orphan_count: number;
  is_settled: number;
}

export interface SentMessage {
  readonly chatId: string;
  readonly telegramMessageId: number;
  readonly text: string;
  readonly isSettled: boolean;
  readonly blockHashes: readonly string[];
  readonly now: number;
}

export interface MessageEdit {
  readonly text: string;
  readonly orphanCount: number;
  readonly isSettled: boolean;
  readonly now: number;
}

const toStoredMessage = (row: MessageRow): StoredMessage => ({
  id: row.id,
  chatId: row.chat_id,
  telegramMessageId: row.telegram_message_id,
  lastRenderedText: row.last_rendered_text,
  editedOrphanCount: row.edited_orphan_count,
  isSettled: row.is_settled === 1,
});

/** Announcement messages and their link to the blocks they show. */
export class MessagesRepo {
  private readonly insertStmt;
  private readonly markBlockStmt;
  private readonly unsettledStmt;
  private readonly editStmt;
  private readonly settleStmt;
  private readonly skipUnsentStmt;

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO messages (chat_id, telegram_message_id, last_rendered_text, is_settled,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.markBlockStmt = db.prepare(
      'UPDATE blocks SET sent = 1, message_ref = ?, updated_at = ? WHERE hash = ?',
    );
    this.unsettledStmt = db.prepare<[], MessageRow>(
      `SELECT id, chat_id, telegram_message_id, last_rendered_text, edited_orphan_count, is_settled
       FROM messages WHERE is_settled = 0 ORDER BY id ASC`,
    );
    this.editStmt = db.prepare(
      `UPDATE messages SET last_rendered_text = ?, edited_orphan_count = ?, is_settled = ?,
         updated_at = ? WHERE id = ?`,
    );
    this.settleStmt = db.prepare('UPDATE messages SET is_settled = 1, updated_at = ? WHERE id = ?');
    this.skipUnsentStmt = db.prepare(
      `UPDATE blocks SET sent = 1, updated_at = ?
       WHERE status = '${BlockStatus.CANONICAL}' AND sent = 0`,
    );
  }

  /**
   * Records a message Telegram has accepted and marks its blocks as sent, atomically.
   * Call only after the send succeeded, so a crash can never mark an unsent block as sent.
   */
  recordSent(message: SentMessage): number {
    return this.db.transaction(() => {
      const { lastInsertRowid } = this.insertStmt.run(
        message.chatId,
        message.telegramMessageId,
        message.text,
        message.isSettled ? 1 : 0,
        message.now,
        message.now,
      );
      const messageRef = Number(lastInsertRowid);
      for (const hash of message.blockHashes) this.markBlockStmt.run(messageRef, message.now, hash);
      return messageRef;
    })();
  }

  listUnsettled(): StoredMessage[] {
    return this.unsettledStmt.all().map(toStoredMessage);
  }

  recordEdit(id: number, edit: MessageEdit): void {
    this.editStmt.run(edit.text, edit.orphanCount, edit.isSettled ? 1 : 0, edit.now, id);
  }

  markSettled(id: number, now: number): void {
    this.settleStmt.run(now, id);
  }

  /**
   * Marks every stored, not yet announced canonical block as sent without a message. Used when
   * an announcement chat is set after a period without one, so only new blocks get announced.
   * Returns how many blocks were skipped.
   */
  skipUnsent(now: number): number {
    return this.skipUnsentStmt.run(now).changes;
  }
}
