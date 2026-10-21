import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AdminsRepo } from '../../src/db/admins-repo.js';
import { openDatabase } from '../../src/db/database.js';
import { KvRepo } from '../../src/db/kv-repo.js';
import { MessagesRepo } from '../../src/db/messages-repo.js';
import { AdminClaim } from '../../src/settings/admin-claim.js';
import { BotSettings } from '../../src/settings/bot-settings.js';
import { createMemoryLog, type LogEntry } from '../support/harness.js';

// Wrap the real timingSafeEqual so the test can observe how the claim code is compared.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

describe('AdminClaim comparison', () => {
  it('compares SHA-256 digests with crypto.timingSafeEqual', () => {
    const db = openDatabase(':memory:');
    const kv = new KvRepo(db);
    const logs: LogEntry[] = [];
    const settings = new BotSettings({
      db,
      kv,
      admins: new AdminsRepo(db),
      messages: new MessagesRepo(db),
      env: { chatId: null, alertChatId: null, adminIds: [] },
    });
    const claim = new AdminClaim({ db, kv, settings, log: createMemoryLog(logs), now: () => 0 });
    claim.issueIfNeeded();
    vi.mocked(timingSafeEqual).mockClear();

    expect(claim.redeem('00000000000000000000000000000000', '77')).toBe('invalid');

    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    const [actual, expected] = vi.mocked(timingSafeEqual).mock.calls[0] ?? [];
    const SHA256_BYTES = 32;
    expect((actual as Buffer).length).toBe(SHA256_BYTES);
    expect((expected as Buffer).length).toBe(SHA256_BYTES);
    db.close();
  });
});
