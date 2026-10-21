import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import { MIGRATIONS } from '../../src/db/migrations.js';

const DISCORD_MIGRATION_VERSION = 4;

describe('migration 4 (discord_sent)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cointmu-bot-migrate-'));

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('upgrades a v3 database and counts existing blocks as already on Discord', () => {
    const path = join(dir, 'v3.db');
    const v3 = new Database(path);
    for (const sql of MIGRATIONS.slice(0, DISCORD_MIGRATION_VERSION - 1)) v3.exec(sql);
    v3.pragma(`user_version = ${DISCORD_MIGRATION_VERSION - 1}`);
    v3.exec(`INSERT INTO blocks (hash, number, parent_hash, miner, timestamp, difficulty, nonce,
      mix_hash, tx_count, first_seen_at, status, sent, created_at, updated_at)
      VALUES ('0x1', 1, '0x0', '0xm', 1, '1', '0x1', '0x2', 0, 1, 'canonical', 0, 1, 1)`);
    v3.close();

    const db = openDatabase(path);

    expect(db.pragma('user_version', { simple: true })).toBe(DISCORD_MIGRATION_VERSION);
    expect(db.prepare('SELECT sent, discord_sent FROM blocks').get()).toEqual({
      sent: 0,
      discord_sent: 1,
    });
    db.close();
  });
});
