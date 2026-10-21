import { randomBytes } from 'node:crypto';
import {
  PendingKind,
  type PendingAction,
  type PendingActionsRepo,
} from '../db/pending-actions-repo.js';
import { code } from '../render/format.js';
import type { BotSettings } from '../settings/bot-settings.js';
import { removeAdminReply, unsetAlertReply, unsetChatReply } from './config-handlers.js';
import { confirmScreen } from './menus.js';
import type { Screen } from './screen.js';

export const CONFIRM_TTL_MS = 5 * 60_000;
const CONFIRM_ID_BYTES = 6;

export type ConfirmKind = Exclude<PendingKind, typeof PendingKind.PICK_ADMIN>;

export const ConfirmCheck = {
  EXPIRED: 'expired',
  NOT_YOURS: 'not_yours',
} as const;
export type ConfirmCheck = (typeof ConfirmCheck)[keyof typeof ConfirmCheck];

export interface Presser {
  readonly userId: string;
  readonly chatId: string;
}

function question(kind: ConfirmKind, argument: string | null): string {
  if (kind === PendingKind.UNSET_CHAT) {
    return '🧹 Yakin lepas tujuan pengumuman? Block tetap disimpan, tapi tidak diumumkan.';
  }
  if (kind === PendingKind.UNSET_ALERT) {
    return '🧹 Yakin lepas tujuan alert? Alert kembali dikirim ke chat pribadi admin.';
  }
  return `❌ Yakin hapus admin ${code(argument ?? '?')}?`;
}

/**
 * Yakin/Batal for destructive actions. The pending action lives in SQLite (id, action, argument,
 * initiator, chat, expiry); the buttons carry only its random id. Expiry is server time, only
 * the initiator may answer, and each confirmation runs at most once.
 */
export class ConfirmFlow {
  constructor(
    private readonly pending: PendingActionsRepo,
    private readonly settings: BotSettings,
  ) {}

  ask(kind: ConfirmKind, argument: string | null, presser: Presser, now: number): Screen {
    const id = randomBytes(CONFIRM_ID_BYTES).toString('base64url');
    this.pending.create({
      id,
      kind,
      argument,
      userId: presser.userId,
      chatId: presser.chatId,
      now,
      ttlMs: CONFIRM_TTL_MS,
    });
    return confirmScreen(question(kind, argument), id);
  }

  /** Validates a Yakin/Batal press without using it up. */
  check(id: string, presser: Presser, now: number): PendingAction | ConfirmCheck {
    const action = this.pending.findLive(id, now);
    if (!action || action.kind === PendingKind.PICK_ADMIN || action.chatId !== presser.chatId) {
      return ConfirmCheck.EXPIRED;
    }
    return action.userId === presser.userId ? action : ConfirmCheck.NOT_YOURS;
  }

  /** Uses up the confirmation and returns the result text, or null if it was used meanwhile. */
  commit(action: PendingAction, isConfirmed: boolean, now: number): string | null {
    if (!this.pending.consume(action.id, now)) return null;
    if (!isConfirmed) return '↩️ Dibatalkan. Tidak ada yang diubah.';
    if (action.kind === PendingKind.UNSET_CHAT) return unsetChatReply(this.settings);
    if (action.kind === PendingKind.UNSET_ALERT) return unsetAlertReply(this.settings);
    return removeAdminReply(this.settings, action.argument ?? '');
  }
}
