import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

const IN_MEMORY_PATH = ':memory:';
const BUSY_TIMEOUT_MS = 5_000;

/** Opens (creating if needed) the SQLite database in WAL mode and applies pending migrations. */
export function openDatabase(path: string): Db {
  if (path !== IN_MEMORY_PATH) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const currentVersion = Number(db.pragma('user_version', { simple: true }));
  MIGRATIONS.slice(currentVersion).forEach((sql, offset) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${currentVersion + offset + 1}`);
    })();
  });
}
