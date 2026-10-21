import { describe, expect, it } from 'vitest';
import { RateLimitedTelegram } from '../../src/telegram/rate-limited.js';
import { TelegramApiError, type TelegramApi } from '../../src/telegram/types.js';
import { silentLog } from '../support/harness.js';

function fakeApi(failures: TelegramApiError[]): TelegramApi & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sendMessage: () => {
      calls.push(Date.now());
      const failure = failures.shift();
      return failure ? Promise.reject(failure) : Promise.resolve(calls.length);
    },
    editMessage: () => Promise.resolve(),
    answerCallback: () => Promise.resolve(),
    setMyCommands: () => Promise.resolve(),
    deleteMyCommands: () => Promise.resolve(),
    getUpdates: () => Promise.resolve([]),
  };
}

const rateLimited = (retryAfterS: number) =>
  new TelegramApiError('sendMessage', 429, 'Too Many Requests', retryAfterS);

describe('RateLimitedTelegram', () => {
  it('waits retry_after on 429 and then succeeds', async () => {
    const api = fakeApi([rateLimited(0.2)]);
    const telegram = new RateLimitedTelegram(api, {
      minGapMs: 0,
      maxQueuedReplies: 20,
      log: silentLog,
    });

    const messageId = await telegram.sendMessage('1', 'hi');

    expect(messageId).toBe(2);
    const [first = 0, second = 0] = api.calls;
    expect(second - first).toBeGreaterThanOrEqual(190);
  });

  it('keeps a minimum gap between consecutive calls', async () => {
    const api = fakeApi([]);
    const telegram = new RateLimitedTelegram(api, {
      minGapMs: 100,
      maxQueuedReplies: 20,
      log: silentLog,
    });

    await Promise.all([telegram.sendMessage('1', 'a'), telegram.sendMessage('1', 'b')]);

    const [first = 0, second = 0] = api.calls;
    expect(second - first).toBeGreaterThanOrEqual(95);
  });

  it('does not retry other errors and keeps the queue alive', async () => {
    const api = fakeApi([
      new TelegramApiError('sendMessage', 400, 'Bad Request: chat not found', null),
    ]);
    const telegram = new RateLimitedTelegram(api, {
      minGapMs: 0,
      maxQueuedReplies: 20,
      log: silentLog,
    });

    await expect(telegram.sendMessage('1', 'a')).rejects.toThrow('chat not found');
    await expect(telegram.sendMessage('1', 'b')).resolves.toBe(2);
  });
});
