import type { TelegramApi, TelegramUpdate } from './types.js';

/** Commands are disabled in dry-run, so these calls never happen; they are no-ops. */
const noop = (): Promise<void> => Promise.resolve();

const RULE = '─'.repeat(60);

function writeStdout(text: string): void {
  process.stdout.write(text);
}

/**
 * DRY_RUN stand-in: prints what would be sent or edited and returns fake message ids.
 * Never touches the network. Use a separate DB_PATH, since its fake ids are stored as sent.
 */
export class DryRunTelegram implements TelegramApi {
  private nextMessageId = 1;

  constructor(private readonly print: (text: string) => void = writeStdout) {}

  sendMessage(chatId: string, html: string): Promise<number> {
    const messageId = this.nextMessageId;
    this.nextMessageId += 1;
    this.print(`${RULE}\n[DRY-RUN] sendMessage chat=${chatId} message_id=${messageId}\n${html}\n`);
    return Promise.resolve(messageId);
  }

  editMessage(chatId: string, messageId: number, html: string): Promise<void> {
    this.print(
      `${RULE}\n[DRY-RUN] editMessageText chat=${chatId} message_id=${messageId}\n${html}\n`,
    );
    return Promise.resolve();
  }

  answerCallback = noop;
  setMyCommands = noop;
  deleteMyCommands = noop;

  getUpdates(): Promise<TelegramUpdate[]> {
    return Promise.resolve([]);
  }
}
