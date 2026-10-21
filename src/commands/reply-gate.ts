const MINUTE_MS = 60_000;
/** Above this many remembered views, stale ones are pruned to bound memory. */
const PRUNE_THRESHOLD = 1000;

export const Admission = {
  OK: 'ok',
  /** Queue full or the group's per-minute reply budget is spent. */
  BUSY: 'busy',
  /** The same view was just shown in this chat. */
  DUPLICATE: 'duplicate',
} as const;
export type Admission = (typeof Admission)[keyof typeof Admission];

export interface ReplyGateOptions {
  readonly queuedReplies: () => number;
  readonly maxQueued: number;
  readonly perGroupPerMinute: number;
  readonly duplicateWindowMs: number;
}

export interface ReplyRequest {
  readonly chatId: string;
  readonly isGroup: boolean;
  /** Set for repeatable views (status/last/top) sent as a new message; null otherwise. */
  readonly viewKey: string | null;
}

/**
 * Admission control for command replies, decided before anything is queued: duplicate views
 * are suppressed, groups get a per-minute reply budget, and the reply queue is never overfilled.
 */
export class ReplyGate {
  private readonly groupSends = new Map<string, number[]>();
  private readonly lastView = new Map<string, number>();

  constructor(private readonly options: ReplyGateOptions) {}

  admit(request: ReplyRequest, now: number): Admission {
    const viewId = request.viewKey === null ? null : `${request.chatId}|${request.viewKey}`;
    const lastShown = viewId === null ? undefined : this.lastView.get(viewId);
    if (lastShown !== undefined && now - lastShown < this.options.duplicateWindowMs) {
      return Admission.DUPLICATE;
    }
    if (this.options.queuedReplies() >= this.options.maxQueued) return Admission.BUSY;
    if (request.isGroup && !this.takeGroupBudget(request.chatId, now)) return Admission.BUSY;
    if (viewId !== null) this.rememberView(viewId, now);
    return Admission.OK;
  }

  private takeGroupBudget(chatId: string, now: number): boolean {
    const recent = (this.groupSends.get(chatId) ?? []).filter((at) => now - at < MINUTE_MS);
    if (recent.length >= this.options.perGroupPerMinute) {
      this.groupSends.set(chatId, recent);
      return false;
    }
    recent.push(now);
    this.groupSends.set(chatId, recent);
    return true;
  }

  private rememberView(viewId: string, now: number): void {
    this.lastView.set(viewId, now);
    if (this.lastView.size <= PRUNE_THRESHOLD) return;
    for (const [id, at] of this.lastView) {
      if (now - at >= this.options.duplicateWindowMs) this.lastView.delete(id);
    }
  }
}
