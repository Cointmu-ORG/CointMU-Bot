/** Bump when button meanings change: older buttons then answer "menu kedaluwarsa". */
const VERSION = 'v1';
const MAX_CALLBACK_DATA_BYTES = 64;

export const Action = {
  MENU: 'm',
  HELP: 'h',
  STATUS: 'st',
  LAST: 'lb',
  TOP: 'tp',
  SETTINGS: 's',
  SET_CHAT: 'sc',
  SET_ALERT: 'sa',
  UNSET_CHAT: 'uc',
  UNSET_ALERT: 'ua',
  CHATS: 'ch',
  ADMINS: 'ad',
  REMOVE_ADMIN: 'rm',
  ADD_ADMIN: 'aa',
  CONFIRM_YES: 'y',
  CONFIRM_NO: 'n',
} as const;
export type Action = (typeof Action)[keyof typeof Action];

const KNOWN_ACTIONS: readonly string[] = Object.values(Action);
/** Optional argument: a user id or a pending-action id (letters, digits, - and _). */
const ARGUMENT_PATTERN = /^[\w-]{1,32}$/;

export interface DecodedAction {
  readonly action: Action;
  readonly arg: string | null;
}

export function encodeAction(action: Action, arg?: string): string {
  const data = arg === undefined ? `${VERSION}:${action}` : `${VERSION}:${action}:${arg}`;
  if (Buffer.byteLength(data) > MAX_CALLBACK_DATA_BYTES) {
    throw new Error(`callback_data too long: ${data.length} bytes`);
  }
  return data;
}

/** Null for anything not produced by this version of the bot (old menus, forged data). */
export function decodeAction(data: string): DecodedAction | null {
  const [version, action, arg, ...rest] = data.split(':');
  if (version !== VERSION || !action || !KNOWN_ACTIONS.includes(action) || rest.length > 0) {
    return null;
  }
  if (arg !== undefined && !ARGUMENT_PATTERN.test(arg)) return null;
  return { action: action as Action, arg: arg ?? null };
}
