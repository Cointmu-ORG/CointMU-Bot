import type { Logger } from '../logger.js';
import { ChatType, type IncomingMessage } from '../telegram/types.js';
import { Denial, type AccessPolicy } from './access.js';
import { parseCommand } from './parse.js';
import {
  REPLY_ADMIN_ONLY,
  REPLY_ANONYMOUS_REJECTED,
  REPLY_CHANNEL_REJECTED,
  REPLY_STATS_DENIED,
} from './replies.js';
import { asScreen, textScreen, type Screen } from './screen.js';
import type { CommandTable, SenderMessage } from './types.js';

export interface RouterDeps {
  readonly commands: CommandTable;
  readonly policy: AccessPolicy;
  readonly log: Logger;
}

/** What to do with a typed message: reply (maybe deduplicated by viewKey) or stay silent. */
export type TypedOutcome =
  | { readonly kind: 'reply'; readonly screen: Screen; readonly viewKey: string | null }
  | { readonly kind: 'silent' };

const SILENT: TypedOutcome = { kind: 'silent' };
const reply = (text: string): TypedOutcome => ({
  kind: 'reply',
  screen: textScreen(text),
  viewKey: null,
});

/** The identified sender, or the rejection reply for channel posts and anonymous senders. */
function identifySender(message: IncomingMessage): SenderMessage | string {
  if (message.chatType === ChatType.CHANNEL) return REPLY_CHANNEL_REJECTED;
  if (message.fromId === null || message.isAnonymous) return REPLY_ANONYMOUS_REJECTED;
  return { ...message, fromId: message.fromId };
}

/** Denials of typed commands: cooldown is silent; admin-only is silent in groups. */
function denialOutcome(denial: Denial, chatType: ChatType): TypedOutcome {
  if (denial === Denial.COOLDOWN) return SILENT;
  if (denial === Denial.STATS_DENIED) return reply(REPLY_STATS_DENIED);
  return chatType === ChatType.PRIVATE ? reply(REPLY_ADMIN_ONLY) : SILENT;
}

/**
 * Routes typed commands. Order: unknown text is ignored; the command's observer runs; channel
 * posts and anonymous senders are rejected; then the shared AccessPolicy (cooldown + access).
 */
export class CommandRouter {
  constructor(private readonly deps: RouterDeps) {}

  handle(message: IncomingMessage, now: number): TypedOutcome {
    const parsed = parseCommand(message.text);
    const spec = parsed ? this.deps.commands[parsed.name] : undefined;
    if (!parsed || !spec) return SILENT;
    spec.observe?.(message);
    const sender = identifySender(message);
    if (typeof sender === 'string') return reply(sender);

    const who = { userId: sender.fromId, chatId: sender.chatId, chatType: sender.chatType };
    const denial = this.deps.policy.check(spec.access, who, now);
    if (denial !== null) {
      this.deps.log.info('command denied', { command: parsed.name, userId: who.userId, denial });
      return denialOutcome(denial, sender.chatType);
    }
    this.deps.log.info('command', { command: parsed.name, userId: who.userId });
    const isAdmin = this.deps.policy.isAdmin(who.userId);
    return {
      kind: 'reply',
      screen: asScreen(spec.run({ message: sender, args: parsed.args, isAdmin, now })),
      viewKey: spec.viewKey?.(parsed.args) ?? null,
    };
  }
}
