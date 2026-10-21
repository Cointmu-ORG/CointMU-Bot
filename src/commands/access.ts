import type { BotSettings } from '../settings/bot-settings.js';
import { ChatType } from '../telegram/types.js';
import type { Cooldown } from './cooldown.js';
import { CommandAccess } from './types.js';

export const Denial = {
  COOLDOWN: 'cooldown',
  ADMIN_ONLY: 'admin_only',
  STATS_DENIED: 'stats_denied',
} as const;
export type Denial = (typeof Denial)[keyof typeof Denial];

export interface AccessPolicyDeps {
  readonly settings: BotSettings;
  readonly cooldown: Cooldown;
  readonly allowedChatIds: readonly string[];
}

/**
 * The one permission check for typed commands and button presses alike. Non-admins are rate
 * limited first (the cooldown is spent even on a denial), then the access level is checked.
 */
export class AccessPolicy {
  constructor(private readonly deps: AccessPolicyDeps) {}

  isAdmin(userId: string): boolean {
    return this.deps.settings.isAdmin(userId);
  }

  /** Stats (and the main menu) are public in the announcement chat and ALLOWED_CHAT_IDS. */
  isPublicStatsChat(chatId: string, chatType: ChatType): boolean {
    if (chatType === ChatType.PRIVATE) return false;
    const announce = this.deps.settings.announceDestination();
    return chatId === announce?.chatId || this.deps.allowedChatIds.includes(chatId);
  }

  check(
    access: CommandAccess,
    who: { readonly userId: string; readonly chatId: string; readonly chatType: ChatType },
    now: number,
  ): Denial | null {
    if (this.isAdmin(who.userId)) return null;
    if (!this.deps.cooldown.tryAcquire(who.userId, now)) return Denial.COOLDOWN;
    if (access === CommandAccess.PUBLIC) return null;
    if (access === CommandAccess.ADMIN) return Denial.ADMIN_ONLY;
    return this.isPublicStatsChat(who.chatId, who.chatType) ? null : Denial.STATS_DENIED;
  }
}
