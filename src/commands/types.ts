import type { IncomingMessage } from '../telegram/types.js';
import type { Screen } from './screen.js';

export const CommandAccess = {
  /** Anyone (subject to the per-user cooldown). */
  PUBLIC: 'public',
  /** Admins anywhere; anyone else only in the announcement chat or ALLOWED_CHAT_IDS. */
  STATS: 'stats',
  /** Bot admins only. */
  ADMIN: 'admin',
} as const;
export type CommandAccess = (typeof CommandAccess)[keyof typeof CommandAccess];

/** A message from an identified person (channel posts and anonymous senders are rejected first). */
export type SenderMessage = IncomingMessage & { readonly fromId: string };

export interface CommandContext {
  readonly message: SenderMessage;
  readonly args: string;
  readonly isAdmin: boolean;
  readonly now: number;
}

/** Returns the reply in Telegram HTML, optionally with buttons. */
export type CommandHandler = (context: CommandContext) => string | Screen;

export interface CommandSpec {
  readonly access: CommandAccess;
  readonly run: CommandHandler;
  /**
   * Runs for every received instance before any check (channel, anonymous, cooldown, access),
   * for side effects that must not be skipped, e.g. burning a claim code posted in a group.
   */
  readonly observe?: (message: IncomingMessage) => void;
  /** Identifies the view for duplicate suppression (e.g. "last:10"); omit to never dedupe. */
  readonly viewKey?: (args: string) => string;
}

export type CommandTable = Readonly<Record<string, CommandSpec>>;
