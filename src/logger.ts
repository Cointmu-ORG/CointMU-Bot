export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const REDACTED = '[REDACTED]';
const secrets = new Set<string>();

/** Registers a value (e.g. the bot token) that must never appear in log output. */
export function registerSecret(value: string | null): void {
  if (value) secrets.add(value);
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  return result;
}

/** Short, single-line description of any thrown value (prefers ethers' `shortMessage`). */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const shortMessage: unknown = Reflect.get(error, 'shortMessage');
  const message = typeof shortMessage === 'string' ? shortMessage : error.message;
  return error.cause instanceof Error ? `${message} (cause: ${error.cause.message})` : message;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) return describeError(value);
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** JSON-lines logger on stdout; registered secrets are redacted from every line. */
export function createLogger(
  minLevel: LogLevel,
  write: (line: string) => void = writeStdout,
): Logger {
  const minRank = LOG_LEVELS.indexOf(minLevel);
  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(level) < minRank) return;
    const entry: LogFields = { time: new Date().toISOString(), level, msg: message };
    for (const [key, value] of Object.entries(fields)) entry[key] = serialize(value);
    write(redactSecrets(JSON.stringify(entry)));
  };
  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}
