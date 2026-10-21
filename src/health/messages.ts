import type { DeepReorgInfo } from '../collector/collector.js';
import { IncidentKind, type Incident } from '../domain/incident.js';
import { code, escapeHtml, formatDuration } from '../render/format.js';

export const INCIDENT_TITLES: Readonly<Record<IncidentKind, string>> = {
  [IncidentKind.RPC_DOWN]: 'RPC node tidak merespons',
  [IncidentKind.STALLED]: 'Head block tidak naik',
  [IncidentKind.LOW_PEERS]: 'Peer node di bawah minimum',
  [IncidentKind.SYNCING]: 'Node sedang syncing',
};

const INCIDENT_ICONS: Readonly<Record<IncidentKind, string>> = {
  [IncidentKind.RPC_DOWN]: '🚨',
  [IncidentKind.STALLED]: '🧊',
  [IncidentKind.LOW_PEERS]: '🔌',
  [IncidentKind.SYNCING]: '🔄',
};

function formatTimestamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function renderAlert(incident: Incident): string {
  return [
    `${INCIDENT_ICONS[incident.kind]} <b>${escapeHtml(INCIDENT_TITLES[incident.kind])}</b>`,
    escapeHtml(incident.detail),
    `Mulai: ${code(formatTimestamp(incident.startedAt))}`,
  ].join('\n');
}

export function renderRecovery(incident: Incident, resolvedAt: number): string {
  return [
    `✅ <b>Pulih:</b> ${escapeHtml(INCIDENT_TITLES[incident.kind])}`,
    `Durasi gangguan: ${code(formatDuration(resolvedAt - incident.startedAt))}`,
  ].join('\n');
}

export function renderDeepReorg(info: DeepReorgInfo): string {
  return [
    '⚠️ <b>Reorg dalam terdeteksi</b>',
    `Titik temu tidak ditemukan dalam batas pencarian; rantai diambil ulang dari ${code(
      `#${info.forkNumber + 1}`,
    )}.`,
    `Block yang jadi orphaned: ${code(info.orphaned)}`,
  ].join('\n');
}
