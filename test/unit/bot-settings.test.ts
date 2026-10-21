import { afterEach, describe, expect, it } from 'vitest';
import { AdminsRepo } from '../../src/db/admins-repo.js';
import { BlocksRepo } from '../../src/db/blocks-repo.js';
import { ChainWriter } from '../../src/db/chain-writer.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { KvRepo } from '../../src/db/kv-repo.js';
import { MessagesRepo } from '../../src/db/messages-repo.js';
import type { ChainBlock } from '../../src/domain/block.js';
import { BotSettings, type EnvSettings } from '../../src/settings/bot-settings.js';

const NO_ENV: EnvSettings = { chatId: null, alertChatId: null, adminIds: [] };

const chainBlock = (number: number): ChainBlock => ({
  number,
  hash: `0x${number.toString(16).padStart(64, '0')}`,
  parentHash: `0x${(number - 1).toString(16).padStart(64, '0')}`,
  miner: '0xminer',
  timestamp: number * 12,
  difficulty: 1000n,
  nonce: '0x1',
  mixHash: '0x2',
  txCount: 0,
});

describe('BotSettings', () => {
  let db: Db;

  const create = (env: EnvSettings = NO_ENV) => {
    db = openDatabase(':memory:');
    return new BotSettings({
      db,
      kv: new KvRepo(db),
      admins: new AdminsRepo(db),
      messages: new MessagesRepo(db),
      env,
    });
  };

  afterEach(() => db.close());

  it('treats the union of env and stored admins as admins', () => {
    const settings = create({ ...NO_ENV, adminIds: ['1'] });
    settings.addAdmin('2', '1', 0);

    expect(settings.adminIds()).toEqual(['1', '2']);
    expect(settings.isAdmin('2')).toBe(true);
    expect(settings.isEnvAdmin('2')).toBe(false);
  });

  it('never removes an env admin from chat', () => {
    const settings = create({ ...NO_ENV, adminIds: ['1'] });
    settings.addAdmin('2', '1', 0);

    expect(settings.removeAdmin('1')).toBe('env_admin');
    expect(settings.isAdmin('1')).toBe(true);
  });

  it('refuses to remove the last admin', () => {
    const settings = create();
    settings.addAdmin('7', 'claim', 0);

    expect(settings.removeAdmin('7')).toBe('last_admin');
    expect(settings.adminIds()).toEqual(['7']);
  });

  it('removes a stored admin while another admin remains', () => {
    const settings = create({ ...NO_ENV, adminIds: ['1'] });
    settings.addAdmin('2', '1', 0);

    expect(settings.removeAdmin('2')).toBe('ok');
    expect(settings.removeAdmin('2')).toBe('not_admin');
  });

  it('lets env destinations win and locks them against chat changes', () => {
    const settings = create({ chatId: '-100', alertChatId: '-200', adminIds: [] });

    expect(settings.setAnnounceChat('-5', 0).result).toBe('locked_by_env');
    expect(settings.unsetAlertChat()).toBe('locked_by_env');
    expect(settings.announceDestination()).toEqual({ chatId: '-100', source: 'env' });
    expect(settings.alertChatIds()).toEqual(['-200']);
  });

  it('silently skips stored blocks when an announcement chat is first set', () => {
    const settings = create();
    const blocks = new BlocksRepo(db);
    new ChainWriter(db, blocks, 2).appendBlocks([1, 2, 3].map(chainBlock), {
      now: 0,
      isSeed: false,
    });

    const first = settings.setAnnounceChat('-5', 10);
    expect(first).toEqual({ result: 'ok', skipped: 3 });
    expect(blocks.listUnsent(10)).toEqual([]);

    new ChainWriter(db, blocks, 2).appendBlocks([chainBlock(4)], { now: 20, isSeed: false });
    expect(settings.setAnnounceChat('-6', 30)).toEqual({ result: 'ok', skipped: 0 });
    expect(blocks.listUnsent(10).map((b) => b.number)).toEqual([4]);
  });

  it('skips again after /unsetchat followed by /setchat', () => {
    const settings = create();
    const blocks = new BlocksRepo(db);
    settings.setAnnounceChat('-5', 0);
    expect(settings.unsetAnnounceChat()).toBe('ok');
    new ChainWriter(db, blocks, 2).appendBlocks([chainBlock(1)], { now: 1, isSeed: false });

    expect(settings.setAnnounceChat('-5', 2)).toEqual({ result: 'ok', skipped: 1 });
    expect(settings.unsetAnnounceChat()).toBe('ok');
    expect(settings.unsetAnnounceChat()).toBe('not_set');
  });

  it("falls back to every admin's private chat for alerts", () => {
    const settings = create({ ...NO_ENV, adminIds: ['1'] });
    settings.addAdmin('2', '1', 0);
    expect(settings.alertChatIds()).toEqual(['1', '2']);

    settings.setAlertChat('-9', 0);
    expect(settings.alertChatIds()).toEqual(['-9']);
  });
});
