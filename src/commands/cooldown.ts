/** Above this many tracked users, expired entries are pruned to bound memory. */
const PRUNE_THRESHOLD = 1000;

/** Per-user rate limit: at most one accepted command per `cooldownMs`. In memory only. */
export class Cooldown {
  private readonly lastAcceptedAt = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  /** Returns true (and starts a new cooldown) when the user may run a command now. */
  tryAcquire(userId: string, now: number): boolean {
    const last = this.lastAcceptedAt.get(userId);
    if (last !== undefined && now - last < this.cooldownMs) return false;
    this.lastAcceptedAt.set(userId, now);
    if (this.lastAcceptedAt.size > PRUNE_THRESHOLD) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [userId, at] of this.lastAcceptedAt) {
      if (now - at >= this.cooldownMs) this.lastAcceptedAt.delete(userId);
    }
  }
}
