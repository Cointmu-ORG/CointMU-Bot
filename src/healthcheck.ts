import Database from 'better-sqlite3';

/**
 * Docker HEALTHCHECK: exits 0 when the database shows a successful RPC poll in the last few
 * minutes. Reads DB_PATH directly (read-only) so it works without the bot's full config.
 */
const DEFAULT_DB_PATH = './data/bot.db';
const MAX_POLL_AGE_MS = 180_000;

function main(): number {
  const db = new Database(process.env.DB_PATH ?? DEFAULT_DB_PATH, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const row = db
      .prepare<[], { last_ok: number | null }>(
        'SELECT MAX(updated_at) AS last_ok FROM rpc_samples WHERE ok_count > 0',
      )
      .get();
    const lastOk = row?.last_ok ?? null;
    return lastOk !== null && Date.now() - lastOk <= MAX_POLL_AGE_MS ? 0 : 1;
  } finally {
    db.close();
  }
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(
    `healthcheck failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
