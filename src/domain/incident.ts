export const IncidentKind = {
  RPC_DOWN: 'rpc_down',
  STALLED: 'stalled',
  LOW_PEERS: 'low_peers',
  SYNCING: 'syncing',
} as const;
export type IncidentKind = (typeof IncidentKind)[keyof typeof IncidentKind];

export const AlertState = {
  /** Alert not delivered yet; retried every monitor tick. */
  PENDING: 'pending',
  SENT: 'sent',
  /** Opened inside the cooldown window, or resolved before the alert went out. */
  SUPPRESSED: 'suppressed',
} as const;
export type AlertState = (typeof AlertState)[keyof typeof AlertState];

export interface Incident {
  readonly id: number;
  readonly kind: IncidentKind;
  readonly detail: string;
  readonly startedAt: number;
  readonly resolvedAt: number | null;
  readonly alertState: AlertState;
  readonly isRecoverySent: boolean;
}

/** A condition that is currently unhealthy, with a human readable detail line. */
export interface Problem {
  readonly kind: IncidentKind;
  readonly detail: string;
}
