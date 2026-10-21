import { AlertState, type Incident, type IncidentKind } from '../domain/incident.js';
import type { Db } from './database.js';

interface IncidentRow {
  id: number;
  kind: IncidentKind;
  detail: string;
  started_at: number;
  resolved_at: number | null;
  alert_state: AlertState;
  recovery_sent: number;
}

const COLUMNS = 'id, kind, detail, started_at, resolved_at, alert_state, recovery_sent';

const toIncident = (row: IncidentRow): Incident => ({
  id: row.id,
  kind: row.kind,
  detail: row.detail,
  startedAt: row.started_at,
  resolvedAt: row.resolved_at,
  alertState: row.alert_state,
  isRecoverySent: row.recovery_sent === 1,
});

export class IncidentsRepo {
  private readonly openStmt;
  private readonly listOpenStmt;
  private readonly undeliveredStmt;
  private readonly lastAlertedResolutionStmt;
  private readonly resolveStmt;
  private readonly setAlertStateStmt;
  private readonly recoverySentStmt;

  constructor(db: Db) {
    this.openStmt = db.prepare(
      `INSERT INTO incidents (kind, detail, started_at, alert_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.listOpenStmt = db.prepare<[], IncidentRow>(
      `SELECT ${COLUMNS} FROM incidents WHERE resolved_at IS NULL ORDER BY id ASC`,
    );
    this.undeliveredStmt = db.prepare<[], IncidentRow>(
      `SELECT ${COLUMNS} FROM incidents
       WHERE (resolved_at IS NULL AND alert_state = '${AlertState.PENDING}')
          OR (resolved_at IS NOT NULL AND alert_state = '${AlertState.SENT}' AND recovery_sent = 0)
       ORDER BY id ASC`,
    );
    this.lastAlertedResolutionStmt = db.prepare<[IncidentKind], { resolved_at: number | null }>(
      `SELECT MAX(resolved_at) AS resolved_at FROM incidents
       WHERE kind = ? AND alert_state = '${AlertState.SENT}'`,
    );
    this.resolveStmt = db.prepare(
      `UPDATE incidents SET resolved_at = ?, updated_at = ?,
         alert_state = CASE alert_state WHEN '${AlertState.PENDING}' THEN '${AlertState.SUPPRESSED}'
                       ELSE alert_state END
       WHERE id = ?`,
    );
    this.setAlertStateStmt = db.prepare(
      'UPDATE incidents SET alert_state = ?, updated_at = ? WHERE id = ?',
    );
    this.recoverySentStmt = db.prepare(
      'UPDATE incidents SET recovery_sent = 1, updated_at = ? WHERE id = ?',
    );
  }

  open(kind: IncidentKind, detail: string, alertState: AlertState, now: number): void {
    this.openStmt.run(kind, detail, now, alertState, now, now);
  }

  listOpen(): Incident[] {
    return this.listOpenStmt.all().map(toIncident);
  }

  /** Open incidents whose alert is pending, and alerted incidents whose recovery is not sent. */
  listUndelivered(): Incident[] {
    return this.undeliveredStmt.all().map(toIncident);
  }

  /** When the most recent alerted incident of this kind recovered; drives the cooldown. */
  lastAlertedResolution(kind: IncidentKind): number | null {
    return this.lastAlertedResolutionStmt.get(kind)?.resolved_at ?? null;
  }

  /** Closes an incident. One whose alert never went out is suppressed: no recovery either. */
  resolve(id: number, now: number): void {
    this.resolveStmt.run(now, now, id);
  }

  setAlertState(id: number, state: AlertState, now: number): void {
    this.setAlertStateStmt.run(state, now, id);
  }

  markRecoverySent(id: number, now: number): void {
    this.recoverySentStmt.run(now, id);
  }
}
