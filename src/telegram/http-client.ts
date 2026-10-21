import { z } from 'zod';
import {
  TelegramApiError,
  type BotCommand,
  type CommandScope,
  type SendOptions,
  type TelegramApi,
  type TelegramUpdate,
} from './types.js';
import { parseUpdates } from './updates.js';

export const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
const LONG_POLL_TIMEOUT_S = 25;
const LONG_POLL_GRACE_MS = 10_000;
/** Callback answers are time-critical for the user; give up quickly instead of piling up. */
const CALLBACK_ANSWER_TIMEOUT_MS = 3_000;
const ALLOWED_UPDATES = ['message', 'channel_post', 'callback_query'];
const MS_PER_SECOND = 1000;

const responseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().int().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});
const sentMessageSchema = z.object({ message_id: z.number().int() });
export interface HttpTelegramOptions {
  readonly token: string;
  readonly baseUrl?: string;
}

/**
 * Thin Bot API client over Node's fetch. The token only ever appears in the request URL,
 * which is never logged or included in errors.
 */
export class HttpTelegramApi implements TelegramApi {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: HttpTelegramOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? TELEGRAM_API_BASE_URL;
  }

  async sendMessage(chatId: string, html: string, options: SendOptions = {}): Promise<number> {
    const result = await this.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(options.markup ? { reply_markup: options.markup } : {}),
    });
    return sentMessageSchema.parse(result).message_id;
  }

  async editMessage(
    chatId: string,
    messageId: number,
    html: string,
    options: SendOptions = {},
  ): Promise<void> {
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(options.markup ? { reply_markup: options.markup } : {}),
      });
    } catch (error) {
      if (error instanceof TelegramApiError && error.isNotModified) return;
      throw error;
    }
  }

  async answerCallback(callbackId: string, text: string | null): Promise<void> {
    await this.call(
      'answerCallbackQuery',
      { callback_query_id: callbackId, ...(text ? { text } : {}) },
      AbortSignal.timeout(CALLBACK_ANSWER_TIMEOUT_MS),
    );
  }

  async setMyCommands(commands: readonly BotCommand[], scope: CommandScope): Promise<void> {
    await this.call('setMyCommands', { commands, scope });
  }

  async deleteMyCommands(scope: CommandScope): Promise<void> {
    await this.call('deleteMyCommands', { scope });
  }

  async getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const timeout = AbortSignal.timeout(LONG_POLL_TIMEOUT_S * MS_PER_SECOND + LONG_POLL_GRACE_MS);
    const result = await this.call(
      'getUpdates',
      { offset, timeout: LONG_POLL_TIMEOUT_S, allowed_updates: ALLOWED_UPDATES },
      AbortSignal.any([signal, timeout]),
    );
    return parseUpdates(result);
  }

  private async call(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    // A non-JSON body (e.g. a proxy error page) is reported as an API error below.
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new TelegramApiError(method, response.status, 'unexpected response body', null);
    }
    const payload = parsed.data;
    if (payload.ok) return payload.result;
    throw new TelegramApiError(
      method,
      payload.error_code ?? response.status,
      payload.description ?? 'unknown error',
      payload.parameters?.retry_after ?? null,
    );
  }
}
