import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { READ_ONLY_METHODS } from '../../src/rpc/client.js';
import { readJsonBody } from './http.js';

export const MINER_A = '0x3c9b08645c616ae3966252f276aa23825b3dcd85';
export const MINER_B = '0x1111111111111111111111111111111111111111';
const GENESIS_TIMESTAMP = 1_790_000_000;
const DEFAULT_BLOCK_TIME_S = 12;
const BASE_DIFFICULTY = 1_169_998n;
const HTTP_SERVICE_UNAVAILABLE = 503;
const JSON_RPC_METHOD_NOT_FOUND = -32601;

export interface MockBlock {
  readonly number: number;
  readonly hash: string;
  readonly parentHash: string;
  readonly miner: string;
  readonly timestamp: number;
  readonly difficulty: bigint;
}

const hex = (value: number | bigint): string => `0x${value.toString(16)}`;
const digest = (input: string): string => `0x${createHash('sha256').update(input).digest('hex')}`;

/** Scriptable in-memory PoW chain served over JSON-RPC (read methods only). */
export class MockChain {
  readonly blocks: MockBlock[] = [];
  readonly calls: string[] = [];
  isDown = false;
  peers = 1;
  isSyncing = false;
  chainId = 1912;
  private fork = 0;

  constructor(length: number) {
    for (let i = 0; i < length; i += 1) this.mine();
  }

  get head(): number {
    return this.blocks.length - 1;
  }

  mine(miner: string = MINER_A, blockTimeS: number = DEFAULT_BLOCK_TIME_S): MockBlock {
    const parent = this.blocks.at(-1);
    const number = this.blocks.length;
    const block: MockBlock = {
      number,
      hash: digest(`${number}:${this.fork}:${miner}`),
      parentHash: parent?.hash ?? `0x${'0'.repeat(64)}`,
      miner,
      timestamp: (parent?.timestamp ?? GENESIS_TIMESTAMP) + (parent ? blockTimeS : 0),
      difficulty: BASE_DIFFICULTY + BigInt(number),
    };
    this.blocks.push(block);
    return block;
  }

  /** Drops the newest `depth` blocks and mines `newLength` replacements on another fork. */
  reorg(depth: number, newLength: number, miner: string = MINER_B): void {
    this.blocks.splice(this.blocks.length - depth, depth);
    this.fork += 1;
    for (let i = 0; i < newLength; i += 1) this.mine(miner);
  }

  /** Calls to any method outside the read-only whitelist (must stay empty). */
  forbiddenCalls(): string[] {
    return this.calls.filter((m) => !(READ_ONLY_METHODS as readonly string[]).includes(m));
  }

  respond(method: string, params: unknown[]): { result?: unknown; error?: unknown } {
    switch (method) {
      case 'eth_chainId':
        return { result: hex(this.chainId) };
      case 'eth_blockNumber':
        return { result: hex(this.head) };
      case 'net_peerCount':
        return { result: hex(this.peers) };
      case 'eth_syncing':
        return { result: this.isSyncing ? { currentBlock: hex(this.head) } : false };
      case 'eth_getBlockByNumber': {
        const block = this.blocks[Number(BigInt(String(params[0])))];
        return { result: block ? toRpcBlock(block) : null };
      }
      default:
        return {
          error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `method ${method} not found` },
        };
    }
  }
}

function toRpcBlock(block: MockBlock): Record<string, unknown> {
  return {
    number: hex(block.number),
    hash: block.hash,
    parentHash: block.parentHash,
    miner: block.miner,
    timestamp: hex(block.timestamp),
    difficulty: hex(block.difficulty),
    nonce: `0x${block.hash.slice(2, 18)}`,
    mixHash: digest(`mix:${block.hash}`),
    transactions: [],
  };
}

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Serves `chain` on 127.0.0.1 with a random port. */
export async function startMockRpc(chain: MockChain): Promise<RunningServer> {
  const server = createServer((req, res) => {
    void (async () => {
      const body = (await readJsonBody(req)) as { id: number; method: string; params?: unknown[] };
      chain.calls.push(body.method);
      if (chain.isDown) {
        res.writeHead(HTTP_SERVICE_UNAVAILABLE).end('node down');
        return;
      }
      const reply = chain.respond(body.method, body.params ?? []);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...reply }));
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
