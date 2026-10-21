import type { Logger } from './logger.js';

export interface Loop {
  readonly name: string;
  /** Stops scheduling and waits for the tick in flight (if any) to finish. */
  stop(): Promise<void>;
}

/**
 * Runs `tick` forever, waiting `intervalMs` between the end of one run and the start of the
 * next, so runs never overlap. A failing tick is logged and never crashes the process.
 */
export function startLoop(
  name: string,
  intervalMs: number,
  tick: () => Promise<void>,
  log: Logger,
): Loop {
  let isStopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const run = (): void => {
    // Promise.resolve().then() also turns a synchronous throw inside tick into a rejection.
    inFlight = Promise.resolve()
      .then(tick)
      .catch((error: unknown) => {
        log.error('loop tick failed', { loop: name, error });
      })
      .finally(() => {
        if (!isStopped) timer = setTimeout(run, intervalMs);
      });
  };
  timer = setTimeout(run, 0);

  return {
    name,
    async stop() {
      isStopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
