import type { Leaderboard } from '../db/stats-repo.js';
import type { StoredBlock } from '../domain/block.js';
import type { Incident } from '../domain/incident.js';
import type { HealthSnapshot } from '../health/state.js';
import { INCIDENT_TITLES } from '../health/messages.js';
import { stateOf, type RenderSettings } from '../render/card.js';
import {
  code,
  escapeHtml,
  formatDecimal,
  formatDuration,
  formatHashrate,
} from '../render/format.js';
import { averageBlockTime, computeHashrate } from '../stats/hashrate.js';

const MS_PER_SECOND = 1000;
const PERCENT = 100;

export interface StatusView {
  /** Newest canonical blocks first (HASHRATE_WINDOW + 1 of them). */
  readonly recent: readonly StoredBlock[];
  readonly health: HealthSnapshot;
  readonly openIncidents: readonly Incident[];
  readonly hashrateWindow: number;
  readonly now: number;
}

const yesNo = (value: boolean | null): string => (value === null ? '?' : value ? 'ya' : 'tidak');

export function renderStatus(view: StatusView): string {
  const [tip] = view.recent;
  if (!tip) return '📊 <b>Status CointMU</b>\nBelum ada block tersimpan.';
  const ascending = [...view.recent].reverse();
  const avgBlockTime = averageBlockTime(ascending);
  const hashrate = computeHashrate(ascending);
  const intervals = ascending.length - 1;
  const nodeStatus =
    view.openIncidents.length === 0
      ? '✅ Sehat'
      : `⚠️ ${view.openIncidents.map((i) => escapeHtml(INCIDENT_TITLES[i.kind])).join(', ')}`;
  return [
    '📊 <b>Status CointMU</b>',
    `⛏️ Head: ${code(`#${tip.number}`)} (${formatDuration(view.now - tip.timestamp * MS_PER_SECOND)} lalu)`,
    `🔌 Peer: ${code(view.health.peers ?? '?')}`,
    `⏱️ Block time rata-rata (${intervals} block): ${code(
      avgBlockTime === null ? 'n/a' : `${formatDecimal(avgBlockTime, 1)} detik`,
    )}`,
    `⚡ Hashrate: ${code(hashrate === null ? 'n/a' : `≈ ${formatHashrate(hashrate)}`)}`,
    `🔄 Syncing: ${code(yesNo(view.health.isSyncing))}`,
    `🩺 Node: ${nodeStatus}`,
  ].join('\n');
}

/** Compact list of the given blocks (newest first). */
export function renderLast(
  blocks: readonly StoredBlock[],
  head: number,
  settings: RenderSettings,
): string {
  if (blocks.length === 0) return '🧾 Belum ada block tersimpan.';
  const lines = blocks.map((block) => {
    const state = stateOf(block, head, settings);
    const status =
      state.kind === 'pending' ? `⏳ ${state.confirmations}/${settings.confirmations}` : '✅';
    return `${code(`#${block.number}`)} ${code(block.miner)} ${status}`;
  });
  return [`🧾 <b>${blocks.length} block terakhir</b>`, ...lines].join('\n');
}

function renderLeaderboard(title: string, board: Leaderboard): string[] {
  const header = `<b>${escapeHtml(title)}</b> (${board.total} block)`;
  if (board.top.length === 0) return [header, 'Belum ada block.'];
  const rows = board.top.map((row, index) => {
    const share = board.total === 0 ? 0 : (row.blocks / board.total) * PERCENT;
    return `${index + 1}. ${code(row.miner)} — ${row.blocks} block (${formatDecimal(share, 1)}%)`;
  });
  return [header, ...rows];
}

export function renderTop(lastDay: Leaderboard, session: Leaderboard): string {
  return [
    '🏆 <b>Top wallet</b>',
    ...renderLeaderboard('24 jam terakhir', lastDay),
    '',
    ...renderLeaderboard('Sesi bot ini', session),
  ].join('\n');
}
