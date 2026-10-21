import { afterEach, describe, expect, it } from 'vitest';
import { AdminsRepo } from '../../src/db/admins-repo.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { KvKey, KvRepo } from '../../src/db/kv-repo.js';
import { MessagesRepo } from '../../src/db/messages-repo.js';
import { AdminClaim, hashClaimCode } from '../../src/settings/admin-claim.js';
import { BotSettings } from '../../src/settings/bot-settings.js';
import { createMemoryLog, type LogEntry } from '../support/harness.js';

describe('AdminClaim', () => {
  let db: Db;
  let kv: KvRepo;
  let logs: LogEntry[];
  let settings: BotSettings;

  const create = (envAdmins: string[] = []) => {
    db = openDatabase(':memory:');
    kv = new KvRepo(db);
    logs = [];
    settings = new BotSettings({
      db,
      kv,
      admins: new AdminsRepo(db),
      messages: new MessagesRepo(db),
      env: { chatId: null, alertChatId: null, adminIds: envAdmins },
    });
    return new AdminClaim({ db, kv, settings, log: createMemoryLog(logs), now: () => 0 });
  };
  const codes = () =>
    logs.flatMap((e) => (typeof e.fields.claimCode === 'string' ? [e.fields.claimCode] : []));
  const logText = (entries: LogEntry[]) => entries.map((e) => JSON.stringify(e)).join('\n');

  afterEach(() => db.close());

  it('logs a fresh code but stores only its SHA-256', () => {
    const claim = create();

    claim.issueIfNeeded();

    const [code] = codes();
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    const stored = kv.get(KvKey.CLAIM_CODE_HASH);
    expect(stored).not.toContain(code);
    expect(stored).toBe(hashClaimCode(code ?? '').toString('hex'));
  });

  it('makes the first correct claimant admin and burns the code', () => {
    const claim = create();
    claim.issueIfNeeded();
    const [code = ''] = codes();

    expect(claim.redeem(code, '77')).toBe('ok');
    expect(settings.adminIds()).toEqual(['77']);
    expect(kv.get(KvKey.CLAIM_CODE_HASH)).toBeNull();
    expect(claim.redeem(code, '88')).toBe('disabled');
  });

  it('rejects a wrong code without logging it', () => {
    const claim = create();
    claim.issueIfNeeded();
    const attempt = 'deadbeefdeadbeefdeadbeefdeadbeef';

    expect(claim.redeem(attempt, '77')).toBe('invalid');
    expect(logText(logs)).not.toContain(attempt);
    expect(settings.adminIds()).toEqual([]);
  });

  it('is disabled while an env admin exists', () => {
    const claim = create(['42']);

    claim.issueIfNeeded();

    expect(codes()).toEqual([]);
    expect(claim.isEnabled()).toBe(false);
    expect(claim.redeem('anything', '77')).toBe('disabled');
  });

  it('is disabled as soon as a stored admin exists', () => {
    const claim = create();
    claim.issueIfNeeded();
    settings.addAdmin('5', 'claim', 0);

    expect(claim.isEnabled()).toBe(false);
    claim.issueIfNeeded();
    expect(kv.get(KvKey.CLAIM_CODE_HASH)).toBeNull();
  });

  it('replaces a leaked code and never repeats it afterwards', () => {
    const claim = create();
    claim.issueIfNeeded();
    const [leaked = ''] = codes();
    const logsBeforeBurn = logs.length;

    claim.burnLeaked();

    const [, fresh = ''] = codes();
    expect(fresh).not.toBe(leaked);
    expect(logText(logs.slice(logsBeforeBurn))).not.toContain(leaked);
    expect(claim.redeem(leaked, '77')).toBe('invalid');
    expect(claim.redeem(fresh, '77')).toBe('ok');
  });
});
