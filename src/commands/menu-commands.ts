import type { BotSettings } from '../settings/bot-settings.js';
import type { ChatType } from '../telegram/types.js';
import type { AccessPolicy } from './access.js';
import { mainMenu, type Viewer } from './menus.js';
import { CommandAccess, type CommandSpec } from './types.js';

export interface Who {
  readonly userId: string;
  readonly chatId: string;
  readonly chatType: ChatType;
}

export function viewerFor(policy: AccessPolicy, settings: BotSettings, who: Who): Viewer {
  const isAdmin = policy.isAdmin(who.userId);
  return {
    isAdmin,
    chatType: who.chatType,
    canUseStats: isAdmin || policy.isPublicStatsChat(who.chatId, who.chatType),
    hasAdmins: settings.adminIds().length > 0,
  };
}

/** /start, /help and /menu: role-specific help text with the menu buttons this viewer may use. */
export function createMenuCommands(
  policy: AccessPolicy,
  settings: BotSettings,
): Record<string, CommandSpec> {
  const spec: CommandSpec = {
    access: CommandAccess.PUBLIC,
    run: ({ message }) =>
      mainMenu(
        viewerFor(policy, settings, {
          userId: message.fromId,
          chatId: message.chatId,
          chatType: message.chatType,
        }),
      ),
  };
  return { start: spec, help: spec, menu: spec };
}
