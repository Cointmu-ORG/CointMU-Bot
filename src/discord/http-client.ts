import { z } from 'zod';
import { DiscordApiError, type DiscordPayload, type DiscordWebhook } from './types.js';

const REQUEST_TIMEOUT_MS = 15_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;

const errorBodySchema = z.object({
  message: z.string().optional(),
  /** Seconds, possibly fractional. */
  retry_after: z.number().nonnegative().optional(),
});

function secondsToMs(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * MS_PER_SECOND) : null;
}

/** Remaining = 0 means the next post would be a 429: wait for the bucket to reset. */
function bucketWaitMs(headers: Headers): number {
  if (headers.get('x-ratelimit-remaining') !== '0') return 0;
  return secondsToMs(headers.get('x-ratelimit-reset-after')) ?? 0;
}

async function toError(response: Response): Promise<DiscordApiError> {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null));
  const retryAfterMs =
    response.status === HTTP_TOO_MANY_REQUESTS
      ? (secondsToMs(body.data?.retry_after) ?? secondsToMs(response.headers.get('retry-after')))
      : null;
  return new DiscordApiError(response.status, body.data?.message ?? 'unknown error', retryAfterMs);
}

/**
 * Executes a Discord webhook over Node's fetch. `?wait=true` makes Discord answer only once
 * the message is stored, so a 2xx really means "posted".
 */
export class HttpDiscordWebhook implements DiscordWebhook {
  constructor(private readonly url: string) {}

  async execute(payload: DiscordPayload): Promise<number> {
    const response = await fetch(`${this.url}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await toError(response);
    await response.body?.cancel();
    return bucketWaitMs(response.headers);
  }
}
