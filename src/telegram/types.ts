const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_BAD_REQUEST = 400;
const NOT_MODIFIED_PATTERN = /message is not modified/i;
const MESSAGE_GONE_PATTERN = /message to edit not found|message can't be edited/i;

export const ChatType = {
  PRIVATE: 'private',
  GROUP: 'group',
  SUPERGROUP: 'supergroup',
  CHANNEL: 'channel',
  UNKNOWN: 'unknown',
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

export interface IncomingMessage {
  readonly chatId: string;
  readonly chatType: ChatType;
  /** Null for channel posts, which have no sender. */
  readonly fromId: string | null;
  /**
   * True when Telegram hides the real sender behind a chat (anonymous group admin, or a post
   * forwarded from a linked channel); `fromId` is then a placeholder, not a person.
   */
  readonly isAnonymous: boolean;
  readonly text: string;
  /** Users picked with a KeyboardButtonRequestUsers button (`users_shared`), if any. */
  readonly sharedUsers: SharedUsers | null;
}

export interface SharedUsers {
  readonly requestId: number;
  readonly userIds: readonly string[];
}

/** A press on an inline keyboard button. */
export interface CallbackQuery {
  readonly id: string;
  readonly fromId: string;
  /** Null when the message with the button is no longer accessible. */
  readonly chatId: string | null;
  readonly chatType: ChatType;
  readonly messageId: number | null;
  /** Untrusted: anyone can send any callback data. */
  readonly data: string;
}

export interface TelegramUpdate {
  readonly updateId: number;
  readonly message: IncomingMessage | null;
  readonly callback: CallbackQuery | null;
}

/** Bot API reply_markup (inline keyboard, reply keyboard or keyboard removal), sent as-is. */
export type ReplyMarkup = Readonly<Record<string, unknown>>;

/** Send order when several messages wait: alerts, then digests/status edits, then replies. */
export const Priority = {
  ALERT: 0,
  DIGEST: 1,
  REPLY: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export interface SendOptions {
  readonly markup?: ReplyMarkup;
  /** Defaults to DIGEST. Only REPLY is bounded (and may be rejected when the queue is full). */
  readonly priority?: Priority;
}

export interface BotCommand {
  readonly command: string;
  readonly description: string;
}

/** BotCommandScope: default (private chats), every group, or one specific chat. */
export type CommandScope =
  | { readonly type: 'default' }
  | { readonly type: 'all_group_chats' }
  | { readonly type: 'chat'; readonly chat_id: string };

/** The Bot API calls this bot needs. All text is Telegram HTML. */
export interface TelegramApi {
  /** Resolves with the new message_id once Telegram accepted the message. */
  sendMessage(chatId: string, html: string, options?: SendOptions): Promise<number>;
  /** Resolves (no-op) when Telegram reports the message is not modified. */
  editMessage(
    chatId: string,
    messageId: number,
    html: string,
    options?: SendOptions,
  ): Promise<void>;
  /** Stops the button's loading spinner; `text` shows as a toast only to the presser. */
  answerCallback(callbackId: string, text: string | null): Promise<void>;
  setMyCommands(commands: readonly BotCommand[], scope: CommandScope): Promise<void>;
  deleteMyCommands(scope: CommandScope): Promise<void>;
  getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]>;
}

export class TelegramApiError extends Error {
  override name = 'TelegramApiError';

  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
    /** Seconds to wait, from `parameters.retry_after` on HTTP 429. */
    readonly retryAfterS: number | null,
  ) {
    super(`telegram ${method} failed (${code}): ${description}`);
  }

  get isRateLimited(): boolean {
    return this.code === HTTP_TOO_MANY_REQUESTS && this.retryAfterS !== null;
  }

  get isNotModified(): boolean {
    return this.code === HTTP_BAD_REQUEST && NOT_MODIFIED_PATTERN.test(this.description);
  }

  /** The message was deleted or is too old to edit; retrying will never succeed. */
  get isMessageGone(): boolean {
    return this.code === HTTP_BAD_REQUEST && MESSAGE_GONE_PATTERN.test(this.description);
  }
}
