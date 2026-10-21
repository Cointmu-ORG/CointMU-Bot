import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CLAIM_SOURCE } from '../db/admins-repo.js';
import type { Db } from '../db/database.js';
import { KvKey, type KvRepo } from '../db/kv-repo.js';
import type { Logger } from '../logger.js';
import type { BotSettings } from './bot-settings.js';

/** 128 bits of entropy: not guessable even without attempt limits. */
const CLAIM_CODE_BYTES = 16;
const HASH_ALGORITHM = 'sha256';

export type ClaimResult = 'ok' | 'invalid' | 'disabled';

export interface AdminClaimDeps {
  readonly db: Db;
  readonly kv: KvRepo;
  readonly settings: BotSettings;
  readonly log: Logger;
  readonly now: () => number;
}

export function hashClaimCode(code: string): Buffer {
  return createHash(HASH_ALGORITHM).update(code.trim()).digest();
}

/**
 * One-time admin bootstrap. While no admin exists (env or DB), a random code is printed to the
 * log; the first user to send `/claim <code>` in a private chat becomes admin and the code is
 * burned. Only the code's SHA-256 is stored, and comparison is constant time.
 */
export class AdminClaim {
  constructor(private readonly deps: AdminClaimDeps) {}

  isEnabled(): boolean {
    return this.deps.settings.adminIds().length === 0;
  }

  /** At startup: replace any previous code with a fresh one, or drop it once admins exist. */
  issueIfNeeded(): void {
    if (this.isEnabled()) this.issue('startup');
    else this.deps.kv.delete(KvKey.CLAIM_CODE_HASH);
  }

  /** /claim was sent outside a private chat, so the code must be treated as public. */
  burnLeaked(): void {
    if (this.isEnabled()) this.issue('previous code was sent outside a private chat');
  }

  redeem(code: string, userId: string): ClaimResult {
    if (!this.isEnabled()) return 'disabled';
    const storedHash = this.deps.kv.get(KvKey.CLAIM_CODE_HASH);
    if (storedHash === null || !matchesHash(code, storedHash)) {
      // Never log the attempted code: it may be a near-miss of the real one.
      this.deps.log.warn('admin claim failed: wrong code', { userId });
      return 'invalid';
    }
    const now = this.deps.now();
    this.deps.db.transaction(() => {
      this.deps.settings.addAdmin(userId, CLAIM_SOURCE, now);
      this.deps.kv.delete(KvKey.CLAIM_CODE_HASH);
    })();
    this.deps.log.info('admin claimed; claim code burned', { userId });
    return 'ok';
  }

  private issue(reason: string): void {
    const code = randomBytes(CLAIM_CODE_BYTES).toString('hex');
    this.deps.kv.set(KvKey.CLAIM_CODE_HASH, hashClaimCode(code).toString('hex'), this.deps.now());
    // Printing the code is the point: whoever can read the bot's log may become admin.
    this.deps.log.warn(
      'admin claim code issued: send "/claim <code>" to the bot in a private chat',
      {
        reason,
        claimCode: code,
      },
    );
  }
}

function matchesHash(code: string, storedHashHex: string): boolean {
  const expected = Buffer.from(storedHashHex, 'hex');
  const actual = hashClaimCode(code);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
