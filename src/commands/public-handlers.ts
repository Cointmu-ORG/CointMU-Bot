import type { AdminClaim } from '../settings/admin-claim.js';
import { ChatType, type IncomingMessage } from '../telegram/types.js';
import { code } from '../render/format.js';
import { CommandAccess, type CommandContext, type CommandSpec } from './types.js';

export const REPLY_CLAIM_OK =
  '✅ Kamu sekarang admin bot. Lanjutkan dengan /setchat di grup tujuan.';
export const REPLY_CLAIM_INVALID = '❌ Kode klaim salah atau sudah hangus.';
export const REPLY_CLAIM_DISABLED = 'ℹ️ Klaim admin tidak aktif: bot sudah punya admin.';
export const REPLY_CLAIM_PRIVATE_ONLY =
  '⚠️ /claim hanya untuk chat pribadi dengan bot. Kode yang barusan dikirim dianggap bocor dan sudah hangus; kode baru dicetak di log bot.';

/** /id: anyone; replies with the sender's user id and this chat's id only. */
function renderId({ message }: CommandContext): string {
  return [`🆔 User ID: ${code(message.fromId)}`, `💬 Chat ID: ${code(message.chatId)}`].join('\n');
}

/** /claim <code>: one-time admin bootstrap, private chats only. */
function runClaim(claim: AdminClaim, { message, args }: CommandContext): string {
  if (!claim.isEnabled()) return REPLY_CLAIM_DISABLED;
  if (message.chatType !== ChatType.PRIVATE) return REPLY_CLAIM_PRIVATE_ONLY;
  return claim.redeem(args, message.fromId) === 'ok' ? REPLY_CLAIM_OK : REPLY_CLAIM_INVALID;
}

/** Any /claim outside a private chat (group, channel, anonymous) exposes the code: burn it. */
function burnIfLeaked(claim: AdminClaim, message: IncomingMessage): void {
  if (message.chatType !== ChatType.PRIVATE) claim.burnLeaked();
}

export function createPublicCommands(claim: AdminClaim): Record<string, CommandSpec> {
  return {
    id: { access: CommandAccess.PUBLIC, run: renderId },
    claim: {
      access: CommandAccess.PUBLIC,
      run: (context) => runClaim(claim, context),
      observe: (message) => burnIfLeaked(claim, message),
    },
  };
}
