const COMMAND_PATTERN = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const USER_ID_PATTERN = /^\d+$/;
export const DEFAULT_LAST_COUNT = 10;
export const MAX_LAST_COUNT = 30;

export interface ParsedCommand {
  readonly name: string;
  readonly args: string;
}

/** "/last@CointMuBot 5" -> { name: "last", args: "5" }; null for non-command text. */
export function parseCommand(text: string): ParsedCommand | null {
  const match = COMMAND_PATTERN.exec(text.trim());
  if (!match?.[1]) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

/** Parses the /last argument; falls back to the default and clamps to 1..MAX_LAST_COUNT. */
export function parseLastCount(args: string): number {
  const requested = Number.parseInt(args, 10);
  if (!Number.isFinite(requested)) return DEFAULT_LAST_COUNT;
  return Math.min(MAX_LAST_COUNT, Math.max(1, requested));
}

/** A numeric Telegram user id (as shown by /id), or null. */
export function parseUserId(args: string): string | null {
  const [first = ''] = args.split(/\s+/);
  return USER_ID_PATTERN.test(first) ? first : null;
}
