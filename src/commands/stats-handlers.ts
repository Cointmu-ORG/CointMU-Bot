import type { BlocksRepo } from '../db/blocks-repo.js';
import type { IncidentsRepo } from '../db/incidents-repo.js';
import type { StatsRepo } from '../db/stats-repo.js';
import type { HealthState } from '../health/state.js';
import type { RenderSettings } from '../render/card.js';
import { parseLastCount } from './parse.js';
import { CommandAccess, type CommandSpec } from './types.js';
import { renderLast, renderStatus, renderTop } from './views.js';

const TOP_LIMIT = 10;
const SECONDS_PER_DAY = 86_400;
const MS_PER_SECOND = 1000;

export interface StatsHandlerDeps {
  readonly blocks: BlocksRepo;
  readonly stats: StatsRepo;
  readonly incidents: IncidentsRepo;
  readonly health: HealthState;
  readonly render: RenderSettings;
  readonly sessionStartedAt: number;
}

/** /status, /last [n] and /top. */
export function createStatsCommands(deps: StatsHandlerDeps): Record<string, CommandSpec> {
  const { blocks, stats, incidents, health, render } = deps;
  return {
    status: {
      access: CommandAccess.STATS,
      viewKey: () => 'status',
      run: ({ now }) =>
        renderStatus({
          recent: blocks.listRecentCanonical(render.hashrateWindow + 1),
          health: health.snapshot(),
          openIncidents: incidents.listOpen(),
          hashrateWindow: render.hashrateWindow,
          now,
        }),
    },
    last: {
      access: CommandAccess.STATS,
      viewKey: (args) => `last:${parseLastCount(args)}`,
      run: ({ args }) => {
        const recent = blocks.listRecentCanonical(parseLastCount(args));
        return renderLast(recent, recent[0]?.number ?? 0, render);
      },
    },
    top: {
      access: CommandAccess.STATS,
      viewKey: () => 'top',
      run: ({ now }) =>
        renderTop(
          stats.leaderboardSinceBlockTime(
            Math.floor(now / MS_PER_SECOND) - SECONDS_PER_DAY,
            TOP_LIMIT,
          ),
          stats.leaderboardSinceSeen(deps.sessionStartedAt, TOP_LIMIT),
        ),
    },
  };
}
