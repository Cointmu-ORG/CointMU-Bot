const HTTP_TOO_MANY_REQUESTS = 429;

export interface EmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

/** The subset of Discord's embed object this bot sends. */
export interface DiscordEmbed {
  readonly title: string;
  readonly description?: string;
  readonly color: number;
  /** ISO 8601. */
  readonly timestamp?: string;
  readonly fields?: readonly EmbedField[];
}

/** Webhook execute body: embeds only, and no mention may ever ping anyone. */
export interface DiscordPayload {
  readonly embeds: readonly DiscordEmbed[];
  readonly allowed_mentions: { readonly parse: readonly [] };
}

export interface DiscordWebhook {
  /**
   * Resolves once Discord stored the message, with how long to wait before the next post
   * (the webhook's rate-limit bucket is empty), 0 otherwise.
   */
  execute(payload: DiscordPayload): Promise<number>;
}

/** Never carries the webhook URL: it is a secret (anyone holding it can post). */
export class DiscordApiError extends Error {
  override name = 'DiscordApiError';

  constructor(
    readonly status: number,
    readonly description: string,
    /** From the 429 body's `retry_after` (or the Retry-After header). */
    readonly retryAfterMs: number | null,
  ) {
    super(`discord webhook failed (${status}): ${description}`);
  }

  get isRateLimited(): boolean {
    return this.status === HTTP_TOO_MANY_REQUESTS && this.retryAfterMs !== null;
  }
}
