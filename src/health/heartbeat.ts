import { describeError, type Logger } from '../logger.js';

export const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Pings an external dead-man's switch (e.g. healthchecks.io) while the collector is healthy,
 * so silence there means the bot or the node is in trouble. The URL is never logged.
 */
export class Heartbeat {
  constructor(
    private readonly url: string,
    private readonly isHealthy: () => boolean,
    private readonly log: Logger,
  ) {}

  async tick(): Promise<void> {
    if (!this.isHealthy()) {
      this.log.debug('heartbeat skipped: collector unhealthy');
      return;
    }
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
      if (!response.ok) this.log.warn('heartbeat rejected', { status: response.status });
    } catch (error) {
      this.log.warn('heartbeat failed', { error: describeError(error) });
    }
  }
}
