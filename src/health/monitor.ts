import type { IncidentsRepo } from '../db/incidents-repo.js';
import { AlertState, type IncidentKind, type Problem } from '../domain/incident.js';
import { describeError, type Logger } from '../logger.js';
import { Priority, type TelegramApi } from '../telegram/types.js';
import { assessHealth, type HealthThresholds } from './conditions.js';
import { renderAlert, renderRecovery } from './messages.js';
import type { HealthState } from './state.js';

export const HEALTH_CHECK_INTERVAL_MS = 5_000;

export interface MonitorDeps {
  readonly state: HealthState;
  readonly incidents: IncidentsRepo;
  readonly telegram: TelegramApi;
  /** Where alerts go right now (alert chat, else the admins' private chats); may be empty. */
  readonly alertChatIds: () => readonly string[];
  readonly thresholds: HealthThresholds;
  readonly cooldownMs: number;
  readonly log: Logger;
  readonly now: () => number;
}

/**
 * Turns health conditions into incidents: one alert when an incident opens and one recovery
 * message (with the outage duration) when it closes. Delivery is retried until Telegram
 * accepts it. An incident opened within the cooldown after the previous alerted one recovered
 * stays silent, unless it is still open when the cooldown ends.
 */
export class HealthMonitor {
  constructor(private readonly deps: MonitorDeps) {}

  async tick(): Promise<void> {
    const now = this.deps.now();
    const assessment = assessHealth(this.deps.state.snapshot(), this.deps.thresholds, now);
    this.syncIncidents(assessment.problems, assessment.evaluatedKinds, now);
    await this.deliver(now);
  }

  /** Sends a one-off alert (e.g. deep reorg); failures are logged, not retried. */
  async notify(html: string): Promise<void> {
    if (!(await this.sendToAll(html))) this.deps.log.error('one-off alert was not delivered');
  }

  private syncIncidents(
    problems: readonly Problem[],
    evaluatedKinds: ReadonlySet<IncidentKind>,
    now: number,
  ): void {
    const { incidents } = this.deps;
    const open = new Map(incidents.listOpen().map((incident) => [incident.kind, incident]));
    for (const problem of problems) {
      const existing = open.get(problem.kind);
      const isCoolingDown = this.isCoolingDown(problem.kind, now);
      if (!existing) {
        const state = isCoolingDown ? AlertState.SUPPRESSED : AlertState.PENDING;
        incidents.open(problem.kind, problem.detail, state, now);
        this.deps.log.warn('incident opened', { kind: problem.kind, alertState: state });
      } else if (existing.alertState === AlertState.SUPPRESSED && !isCoolingDown) {
        incidents.setAlertState(existing.id, AlertState.PENDING, now);
      }
    }
    const activeKinds = new Set(problems.map((problem) => problem.kind));
    for (const incident of open.values()) {
      if (evaluatedKinds.has(incident.kind) && !activeKinds.has(incident.kind)) {
        incidents.resolve(incident.id, now);
        this.deps.log.info('incident resolved', { kind: incident.kind });
      }
    }
  }

  private isCoolingDown(kind: IncidentKind, now: number): boolean {
    const lastResolution = this.deps.incidents.lastAlertedResolution(kind);
    return lastResolution !== null && now - lastResolution < this.deps.cooldownMs;
  }

  /** Undelivered alerts wait (and are retried) until at least one destination accepts them. */
  private async deliver(now: number): Promise<void> {
    const { incidents, log } = this.deps;
    for (const incident of incidents.listUndelivered()) {
      const isRecovery = incident.resolvedAt !== null;
      const html = isRecovery
        ? renderRecovery(incident, incident.resolvedAt ?? now)
        : renderAlert(incident);
      if (!(await this.sendToAll(html))) {
        log.warn('alert not delivered yet, will retry', { kind: incident.kind });
        return;
      }
      if (isRecovery) incidents.markRecoverySent(incident.id, now);
      else incidents.setAlertState(incident.id, AlertState.SENT, now);
    }
  }

  /** True when at least one destination accepted the message. */
  private async sendToAll(html: string): Promise<boolean> {
    const chatIds = this.deps.alertChatIds();
    if (chatIds.length === 0) {
      this.deps.log.debug('no alert destination configured');
      return false;
    }
    let isDelivered = false;
    for (const chatId of chatIds) {
      try {
        await this.deps.telegram.sendMessage(chatId, html, { priority: Priority.ALERT });
        isDelivered = true;
      } catch (error) {
        this.deps.log.warn('alert send failed', { chatId, error: describeError(error) });
      }
    }
    return isDelivered;
  }
}
