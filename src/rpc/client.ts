import { FetchRequest, JsonRpcProvider } from 'ethers';
import { z } from 'zod';
import type { ChainBlock } from '../domain/block.js';

/** The only JSON-RPC methods this bot may ever call. Anything else is refused before sending. */
export const READ_ONLY_METHODS = [
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'net_peerCount',
  'eth_syncing',
  'eth_chainId',
] as const;
export type ReadOnlyMethod = (typeof READ_ONLY_METHODS)[number];

const quantity = z.string().regex(/^0x[0-9a-fA-F]+$/);
const hexData = z.string().regex(/^0x[0-9a-fA-F]*$/);
const rawBlockSchema = z.object({
  number: quantity,
  hash: hexData,
  parentHash: hexData,
  miner: hexData,
  timestamp: quantity,
  difficulty: quantity,
  nonce: hexData,
  mixHash: hexData,
  transactions: z.array(z.unknown()),
});

export class ReadOnlyViolationError extends Error {
  override name = 'ReadOnlyViolationError';
}

export class RpcResponseError extends Error {
  override name = 'RpcResponseError';
}

/** Raw JSON-RPC transport; ChainReader is the only caller and enforces the whitelist. */
export interface RpcTransport {
  send(method: string, params: unknown[]): Promise<unknown>;
  close(): void;
}

export interface ChainReader {
  getBlockNumber(): Promise<number>;
  /** Null when the node has no block at that height (e.g. the chain just got shorter). */
  getBlock(number: number): Promise<ChainBlock | null>;
  getPeerCount(): Promise<number>;
  isSyncing(): Promise<boolean>;
  getChainId(): Promise<number>;
  close(): void;
}

export function assertReadOnlyMethod(method: string): asserts method is ReadOnlyMethod {
  if (!(READ_ONLY_METHODS as readonly string[]).includes(method)) {
    throw new ReadOnlyViolationError(`RPC method ${method} is not in the read-only whitelist`);
  }
}

export interface EthersTransportOptions {
  readonly url: string;
  readonly timeoutMs: number;
  readonly chainId: number;
}

/** ethers v6 provider with a static network (no eth_chainId polling) and no request batching. */
export function createEthersTransport(options: EthersTransportOptions): RpcTransport {
  const request = new FetchRequest(options.url);
  request.timeout = options.timeoutMs;
  const provider = new JsonRpcProvider(request, options.chainId, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  return {
    send: (method, params) => provider.send(method, params) as Promise<unknown>,
    close: () => provider.destroy(),
  };
}

function parseQuantity(value: unknown, field: string): number {
  const parsed = quantity.safeParse(value);
  if (!parsed.success) throw new RpcResponseError(`${field}: expected hex quantity`);
  const number = Number(BigInt(parsed.data));
  if (!Number.isSafeInteger(number)) throw new RpcResponseError(`${field}: value out of range`);
  return number;
}

export function toQuantity(value: number): string {
  return `0x${value.toString(16)}`;
}

export function parseBlock(raw: unknown, requested: number): ChainBlock {
  const parsed = rawBlockSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RpcResponseError(`block ${requested}: ${z.prettifyError(parsed.error)}`);
  }
  const block = parsed.data;
  return {
    number: parseQuantity(block.number, 'number'),
    hash: block.hash.toLowerCase(),
    parentHash: block.parentHash.toLowerCase(),
    miner: block.miner.toLowerCase(),
    timestamp: parseQuantity(block.timestamp, 'timestamp'),
    difficulty: BigInt(block.difficulty),
    nonce: block.nonce.toLowerCase(),
    mixHash: block.mixHash.toLowerCase(),
    txCount: block.transactions.length,
  };
}

export function createChainReader(transport: RpcTransport): ChainReader {
  const call = (method: ReadOnlyMethod, params: unknown[] = []): Promise<unknown> => {
    assertReadOnlyMethod(method);
    return transport.send(method, params);
  };
  return {
    getBlockNumber: async () => parseQuantity(await call('eth_blockNumber'), 'eth_blockNumber'),
    getBlock: async (number) => {
      const raw = await call('eth_getBlockByNumber', [toQuantity(number), false]);
      return raw === null ? null : parseBlock(raw, number);
    },
    getPeerCount: async () => parseQuantity(await call('net_peerCount'), 'net_peerCount'),
    isSyncing: async () => (await call('eth_syncing')) !== false,
    getChainId: async () => parseQuantity(await call('eth_chainId'), 'eth_chainId'),
    close: () => transport.close(),
  };
}
