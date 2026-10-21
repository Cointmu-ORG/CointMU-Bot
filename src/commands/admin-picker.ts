import { randomInt } from 'node:crypto';
import { PendingKind, type PendingActionsRepo } from '../db/pending-actions-repo.js';
import type { BotSettings } from '../settings/bot-settings.js';
import { ChatType, type IncomingMessage } from '../telegram/types.js';
import { addAdminReply } from './config-handlers.js';
import { REPLY_ADMIN_ONLY } from './replies.js';
import type { Screen } from './screen.js';

export const PICKER_TTL_MS = 5 * 60_000;
/** request_id is a signed 32-bit integer in the Bot API. */
const MAX_REQUEST_ID = 2 ** 31 - 1;

const PICKER_TEXT =
  '👤 Tekan tombol <b>Pilih pengguna</b> di bawah untuk memilih admin baru (berlaku 5 menit).\nCadangan: /addadmin &lt;user_id&gt; (user ID dari /id).';
const PICKER_EXPIRED =
  '⌛ Permintaan pilih pengguna sudah kedaluwarsa. Buka 👥 Kelola admin → ➕ Tambah admin lagi.';

function withoutKeyboard(text: string): Screen {
  return { text, buttons: [], replyMarkup: { remove_keyboard: true } };
}

/**
 * Add an admin by picking a user in Telegram's UI (KeyboardButtonRequestUsers, Bot API 7.0+).
 * Private chats only. The random request_id is stored per admin for 5 minutes, and a
 * users_shared reply counts only if it comes from that admin with that request_id.
 */
export class AdminPicker {
  constructor(
    private readonly pending: PendingActionsRepo,
    private readonly settings: BotSettings,
  ) {}

  start(userId: string, chatId: string, now: number): Screen {
    const requestId = randomInt(1, MAX_REQUEST_ID);
    this.pending.create({
      id: String(requestId),
      kind: PendingKind.PICK_ADMIN,
      argument: null,
      userId,
      chatId,
      now,
      ttlMs: PICKER_TTL_MS,
    });
    return {
      text: PICKER_TEXT,
      buttons: [],
      replyMarkup: {
        keyboard: [
          [
            {
              text: '👤 Pilih pengguna',
              request_users: { request_id: requestId, user_is_bot: false, max_quantity: 1 },
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    };
  }

  /** Reply to a users_shared message, or null when it is not one we should answer. */
  handleShared(message: IncomingMessage, now: number): Screen | null {
    const shared = message.sharedUsers;
    if (!shared || message.chatType !== ChatType.PRIVATE || message.fromId === null) return null;
    const adminId = message.fromId;
    if (!this.settings.isAdmin(adminId)) return withoutKeyboard(REPLY_ADMIN_ONLY);
    const request = this.pending.findLive(String(shared.requestId), now);
    const isValid =
      request?.kind === PendingKind.PICK_ADMIN &&
      request.userId === adminId &&
      this.pending.consume(request.id, now);
    if (!isValid) return withoutKeyboard(PICKER_EXPIRED);
    const lines = shared.userIds.map((id) => addAdminReply(this.settings, id, adminId, now));
    return withoutKeyboard(lines.join('\n'));
  }
}
