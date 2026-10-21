import { describe, expect, it } from 'vitest';
import {
  assertReadOnlyMethod,
  createChainReader,
  parseBlock,
  ReadOnlyViolationError,
  RpcResponseError,
  type RpcTransport,
} from '../../src/rpc/client.js';

/** Trimmed eth_getBlockByNumber(latest, false) response captured from the CointMU node. */
const GETH_BLOCK = {
  difficulty: '0x125ca4',
  hash: '0x74f371341535b455f7563f66bebee331d0a4d90297cca712eb79c44e521b9905',
  miner: '0x3c9b08645c616ae3966252f276aa23825b3dcd85',
  mixHash: '0xf727ccc396e3b6af4c2a42c51c6dd6f21ba310e10cd7d5bfc587602bbcd61419',
  nonce: '0x36d53405cdac8e8a',
  number: '0x38c0a',
  parentHash: '0x9bd97032385286302c0683e23d6ccd1dd160c848a54c0c74bc60fdef4abc739d',
  timestamp: '0x6ad35d6a',
  totalDifficulty: '0x4a017a2857',
  transactions: [],
  uncles: [],
};

describe('read-only whitelist', () => {
  it.each(['miner_start', 'personal_unlockAccount', 'admin_addPeer', 'eth_sendTransaction'])(
    'refuses %s',
    (method) => {
      expect(() => assertReadOnlyMethod(method)).toThrow(ReadOnlyViolationError);
    },
  );

  it.each([
    'eth_blockNumber',
    'eth_getBlockByNumber',
    'net_peerCount',
    'eth_syncing',
    'eth_chainId',
  ])('allows %s', (method) => {
    expect(() => assertReadOnlyMethod(method)).not.toThrow();
  });

  it('sends only whitelisted methods through the transport', async () => {
    const sent: string[] = [];
    const transport: RpcTransport = {
      send: (method) => {
        sent.push(method);
        return Promise.resolve(method === 'eth_syncing' ? false : '0x1');
      },
      close: () => undefined,
    };
    const reader = createChainReader(transport);

    await reader.getBlockNumber();
    await reader.getPeerCount();
    await reader.isSyncing();
    await reader.getChainId();

    expect(sent).toEqual(['eth_blockNumber', 'net_peerCount', 'eth_syncing', 'eth_chainId']);
  });
});

describe('parseBlock', () => {
  it('extracts the fields a Geth 1.10.26 PoW block carries', () => {
    expect(parseBlock(GETH_BLOCK, 232_458)).toEqual({
      number: 232_458,
      hash: GETH_BLOCK.hash,
      parentHash: GETH_BLOCK.parentHash,
      miner: GETH_BLOCK.miner,
      timestamp: 0x6ad35d6a,
      difficulty: 1_203_364n,
      nonce: GETH_BLOCK.nonce,
      mixHash: GETH_BLOCK.mixHash,
      txCount: 0,
    });
  });

  it('rejects a block without mixHash or nonce', () => {
    const withoutMix: Record<string, unknown> = { ...GETH_BLOCK };
    delete withoutMix.mixHash;

    expect(() => parseBlock(withoutMix, 1)).toThrow(RpcResponseError);
  });
});
