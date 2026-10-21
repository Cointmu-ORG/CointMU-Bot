import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readJsonBody } from './http.js';
import type { RunningServer } from './mock-rpc.js';

export const TEST_TOKEN = '123456:TEST-token_abc';
const HTTP_UNAUTHORIZED = 401;
const FIRST_MESSAGE_ID = 100;

export interface RecordedCall {
  readonly method: string;
  readonly body: Record<string, unknown>;
  /** Wall-clock ms when the mock received the call. */
  readonly at: number;
}

interface ForcedResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Records Bot API calls; responses can be forced per method (e.g. a 429). */
export class MockTelegram {
  readonly calls: RecordedCall[] = [];
  readonly pendingUpdates: unknown[] = [];
  private readonly forced = new Map<string, ForcedResponse[]>();
  private nextMessageId = FIRST_MESSAGE_ID;

  private nextUpdateId = 1;

  /** Queues an incoming text message (or channel post) for the next getUpdates. */
  receive(message: {
    chatId: number;
    chatType: 'private' | 'group' | 'supergroup' | 'channel';
    fromId?: number;
    senderChatId?: number;
    text: string;
  }): void {
    const payload = {
      chat: { id: message.chatId, type: message.chatType },
      ...(message.fromId === undefined ? {} : { from: { id: message.fromId } }),
      ...(message.senderChatId === undefined ? {} : { sender_chat: { id: message.senderChatId } }),
      text: message.text,
    };
    const key = message.chatType === 'channel' ? 'channel_post' : 'message';
    this.pendingUpdates.push({ update_id: this.nextUpdateId, [key]: payload });
    this.nextUpdateId += 1;
  }

  /** Queues a button press; returns the callback query id. */
  press(press: {
    fromId: number;
    chatId: number;
    chatType: 'private' | 'group' | 'supergroup';
    messageId: number;
    data: string;
  }): string {
    const id = `cb${this.nextUpdateId}`;
    this.pendingUpdates.push({
      update_id: this.nextUpdateId,
      callback_query: {
        id,
        from: { id: press.fromId },
        message: { message_id: press.messageId, chat: { id: press.chatId, type: press.chatType } },
        data: press.data,
      },
    });
    this.nextUpdateId += 1;
    return id;
  }

  /** Queues the users_shared message a client sends after picking users. */
  shareUsers(share: { fromId: number; requestId: number; userIds: number[] }): void {
    this.pendingUpdates.push({
      update_id: this.nextUpdateId,
      message: {
        chat: { id: share.fromId, type: 'private' },
        from: { id: share.fromId },
        users_shared: {
          request_id: share.requestId,
          users: share.userIds.map((userId) => ({ user_id: userId })),
        },
      },
    });
    this.nextUpdateId += 1;
  }

  callsOf(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.body.accepted === true);
  }

  /** The toast text answered for a callback id ('' for an answer without toast). */
  toastFor(callbackId: string): string | undefined {
    const answer = this.callsOf('answerCallbackQuery').find(
      (call) => call.body.callback_query_id === callbackId,
    );
    if (answer === undefined) return undefined;
    return typeof answer.body.text === 'string' ? answer.body.text : '';
  }

  failNext(method: string, status: number, body: unknown): void {
    const queue = this.forced.get(method) ?? [];
    queue.push({ status, body });
    this.forced.set(method, queue);
  }

  /** Accepted sendMessage calls only (forced failures excluded). */
  sentTo(chatId: string): string[] {
    return this.calls
      .filter((call) => call.method === 'sendMessage' && call.body.chat_id === chatId)
      .filter((call) => call.body.accepted === true)
      .map((call) => String(call.body.text));
  }

  editsCount(): number {
    return this.calls.filter((c) => c.method === 'editMessageText' && c.body.accepted === true)
      .length;
  }

  respond(method: string, body: Record<string, unknown>): ForcedResponse {
    const forced = this.forced.get(method)?.shift();
    this.calls.push({ method, body: { ...body, accepted: forced === undefined }, at: Date.now() });
    if (forced) return forced;
    if (method === 'getUpdates') {
      const updates = this.pendingUpdates.splice(0);
      return { status: 200, body: { ok: true, result: updates } };
    }
    if (method === 'sendMessage') {
      this.nextMessageId += 1;
      return { status: 200, body: { ok: true, result: { message_id: this.nextMessageId } } };
    }
    return { status: 200, body: { ok: true, result: true } };
  }
}

/** Serves the Bot API mock on 127.0.0.1 with a random port. */
export async function startMockTelegram(mock: MockTelegram): Promise<RunningServer> {
  const server = createServer((req, res) => {
    void (async () => {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
      if (match?.[1] !== TEST_TOKEN || !match[2]) {
        res.writeHead(HTTP_UNAUTHORIZED).end(JSON.stringify({ ok: false, error_code: 401 }));
        return;
      }
      const reply = mock.respond(match[2], body);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
