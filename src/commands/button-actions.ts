import { PendingKind } from '../db/pending-actions-repo.js';
import type { AdminClaim } from '../settings/admin-claim.js';
import type { BotSettings } from '../settings/bot-settings.js';
import type { ChatType } from '../telegram/types.js';
import type { AccessPolicy } from './access.js';
import type { AdminPicker } from './admin-picker.js';
import { Action } from './callback-data.js';
import { renderChats } from './chats-view.js';
import { setAlert, setChat } from './config-handlers.js';
import type { ConfirmFlow } from './confirmations.js';
import { viewerFor } from './menu-commands.js';
import {
  adminsScreen,
  BACK_TO_MAIN,
  BACK_TO_SETTINGS,
  helpText,
  mainMenu,
  settingsMenu,
} from './menus.js';
import { parseUserId } from './parse.js';
import { asScreen, textScreen, withButtons, type Button, type Screen } from './screen.js';
import { CommandAccess, type CommandContext, type CommandTable } from './types.js';

/** One button press, after the chat and message were checked to exist. */
export interface Press {
  readonly userId: string;
  readonly chatId: string;
  readonly chatType: ChatType;
  readonly isPrivate: boolean;
  readonly arg: string | null;
  readonly now: number;
}

export interface ButtonAction {
  readonly access: CommandAccess;
  /** Dedupe key for repeatable views sent as new messages in groups. */
  readonly viewKey?: string;
  /** Needs a private chat (the user picker); elsewhere the press gets a toast. */
  readonly isPrivateOnly?: boolean;
  /** Always a new message, even in private chats (a reply keyboard cannot be edited in). */
  readonly isAlwaysNew?: boolean;
  /** Null means the press is not valid (e.g. a malformed argument): answered as expired. */
  readonly build: (press: Press) => Screen | null;
}

export interface ButtonActionDeps {
  readonly policy: AccessPolicy;
  readonly settings: BotSettings;
  readonly claim: AdminClaim;
  readonly confirm: ConfirmFlow;
  readonly picker: AdminPicker;
  /** Typed command handlers reused by the buttons (status, last, top). */
  readonly commands: CommandTable;
}

function contextOf(press: Press, isAdmin: boolean): CommandContext {
  const message = {
    chatId: press.chatId,
    chatType: press.chatType,
    fromId: press.userId,
    isAnonymous: false,
    text: '',
    sharedUsers: null,
  };
  return { message, args: '', isAdmin, now: press.now };
}

/** Adds a ⬅️ Kembali row in private chats, where navigation edits the same message. */
const back = (press: Press, row: readonly Button[], screen: Screen): Screen =>
  press.isPrivate ? withButtons(screen, [row]) : screen;

export function createButtonActions(deps: ButtonActionDeps): Record<string, ButtonAction> {
  const { policy, settings } = deps;
  const viewer = (press: Press) => viewerFor(policy, settings, press);
  const command = (name: string) => (press: Press) => {
    const spec = deps.commands[name];
    if (!spec) return null;
    const screen = asScreen(spec.run(contextOf(press, policy.isAdmin(press.userId))));
    return back(press, BACK_TO_MAIN, screen);
  };
  return {
    [Action.MENU]: { access: CommandAccess.STATS, build: (press) => mainMenu(viewer(press)) },
    [Action.HELP]: {
      access: CommandAccess.PUBLIC,
      build: (press) => back(press, BACK_TO_MAIN, textScreen(helpText(viewer(press)))),
    },
    [Action.STATUS]: { access: CommandAccess.STATS, viewKey: 'status', build: command('status') },
    [Action.LAST]: { access: CommandAccess.STATS, viewKey: 'last:10', build: command('last') },
    [Action.TOP]: { access: CommandAccess.STATS, viewKey: 'top', build: command('top') },
    ...createSettingsActions(deps),
  };
}

/** The admin-only buttons under ⚙️ Pengaturan. */
function createSettingsActions(deps: ButtonActionDeps): Record<string, ButtonAction> {
  const { settings } = deps;
  const configured = (run: (context: CommandContext) => string) => (press: Press) =>
    back(press, BACK_TO_SETTINGS, textScreen(run(contextOf(press, true))));
  const ask = (kind: Exclude<PendingKind, 'pick_admin'>) => (press: Press) =>
    deps.confirm.ask(kind, null, press, press.now);
  const configDeps = { settings, claim: deps.claim };
  return {
    [Action.SETTINGS]: {
      access: CommandAccess.ADMIN,
      build: (press) => settingsMenu(press.isPrivate),
    },
    [Action.SET_CHAT]: {
      access: CommandAccess.ADMIN,
      build: configured((context) => setChat(configDeps, context)),
    },
    [Action.SET_ALERT]: {
      access: CommandAccess.ADMIN,
      build: configured((context) => setAlert(configDeps, context)),
    },
    [Action.CHATS]: {
      access: CommandAccess.ADMIN,
      build: configured(() => renderChats(settings, deps.claim.isEnabled())),
    },
    [Action.UNSET_CHAT]: { access: CommandAccess.ADMIN, build: ask(PendingKind.UNSET_CHAT) },
    [Action.UNSET_ALERT]: { access: CommandAccess.ADMIN, build: ask(PendingKind.UNSET_ALERT) },
    [Action.ADMINS]: {
      access: CommandAccess.ADMIN,
      build: (press) => adminsScreen(settings, press.isPrivate),
    },
    [Action.REMOVE_ADMIN]: {
      access: CommandAccess.ADMIN,
      build: (press) => {
        const userId = parseUserId(press.arg ?? '');
        if (userId === null) return null;
        return deps.confirm.ask(PendingKind.REMOVE_ADMIN, userId, press, press.now);
      },
    },
    [Action.ADD_ADMIN]: {
      access: CommandAccess.ADMIN,
      isPrivateOnly: true,
      isAlwaysNew: true,
      build: (press) => deps.picker.start(press.userId, press.chatId, press.now),
    },
  };
}
