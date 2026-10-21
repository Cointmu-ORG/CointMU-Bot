import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readJsonBody } from './http.js';
import type { RunningServer } from './mock-rpc.js';

export const DISCORD_TEST_TOKEN = 'TEST-webhook-token_abc';
const WEBHOOK_PATH = `/api/webhooks/1/${DISCORD_TEST_TOKEN}?wait=true`;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;
const BLOCK_TITLE_PATTERN = /Block #(\d+)$/;

export interface DiscordEmbedBody {
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly { name: string; value: string; inline?: boolean }[];
}

export interface DiscordPostBody {
  readonly embeds: readonly DiscordEmbedBody[];
  readonly allowed_mentions?: unknown;
  readonly content?: unknown;
}

export interface RecordedPost {
  readonly body: DiscordPostBody;
  readonly isAccepted: boolean;
}

interface ForcedResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Records webhook executes; responses can be forced (e.g. a 429) or the whole API taken down. */
export class MockDiscord {
  readonly posts: RecordedPost[] = [];
  isDown = false;
  private readonly forced: ForcedResponse[] = [];

  failNext(status: number, body: unknown): void {
    this.forced.push({ status, body });
  }

  accepted(): DiscordPostBody[] {
    return this.posts.filter((post) => post.isAccepted).map((post) => post.body);
  }

  /** Block numbers of every accepted block embed, in posting order (summaries excluded). */
  postedBlocks(): number[] {
    return this.accepted().flatMap((body) =>
      body.embeds.flatMap((embed) => {
        const match = BLOCK_TITLE_PATTERN.exec(embed.title);
        return match?.[1] ? [Number(match[1])] : [];
      }),
    );
  }

  respond(body: DiscordPostBody): ForcedResponse {
    const forced = this.isDown
      ? { status: HTTP_SERVICE_UNAVAILABLE, body: { message: 'down' } }
      : this.forced.shift();
    this.posts.push({ body, isAccepted: forced === undefined });
    return forced ?? { status: 200, body: { id: String(this.posts.length) } };
  }
}

/** Serves the webhook mock on 127.0.0.1 with a random port. */
export async function startMockDiscord(mock: MockDiscord): Promise<RunningServer> {
  const server = createServer((req, res) => {
    void (async () => {
      const body = (await readJsonBody(req)) as DiscordPostBody;
      if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) {
        res.writeHead(HTTP_UNAUTHORIZED).end(JSON.stringify({ message: 'Unknown Webhook' }));
        return;
      }
      const reply = mock.respond(body);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/webhooks/1/${DISCORD_TEST_TOKEN}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
