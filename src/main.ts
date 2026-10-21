import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger, describeError, registerSecret } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;
const EXIT_OK = 0;
const EXIT_FAILURE = 1;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = EXIT_FAILURE;
    return;
  }
  registerSecret(config.botToken);
  registerSecret(config.heartbeatUrl);
  const log = createLogger(config.logLevel);
  const app = createApp(config, { log });
  const startup = new AbortController();
  let isShuttingDown = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info('shutting down');
    startup.abort();
    const forceExit = setTimeout(() => {
      log.error('shutdown timed out, forcing exit');
      process.exit(EXIT_FAILURE);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    await app.stop();
    log.info('stopped');
    process.exitCode = exitCode;
  };

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { error: describeError(reason) });
  });
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', { error: describeError(error) });
    void shutdown(EXIT_FAILURE);
  });
  process.once('SIGINT', () => void shutdown(EXIT_OK));
  process.once('SIGTERM', () => void shutdown(EXIT_OK));

  log.info('starting CointMU Mining Feed', {
    dryRun: config.isDryRun,
    dbPath: config.dbPath,
    commands: config.botToken !== null,
    heartbeat: config.heartbeatUrl !== null,
  });
  try {
    await app.start(startup.signal);
    log.info('running');
  } catch (error) {
    if (startup.signal.aborted) return;
    log.error('startup failed', { error: describeError(error) });
    await shutdown(EXIT_FAILURE);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${describeError(error)}\n`);
  process.exitCode = EXIT_FAILURE;
});
