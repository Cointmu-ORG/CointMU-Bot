import type { DiscordPayload, DiscordWebhook } from './types.js';

const RULE = '─'.repeat(60);
const JSON_INDENT = 2;

function writeStdout(text: string): void {
  process.stdout.write(text);
}

/** DRY_RUN stand-in: prints the payload that would be posted. Never touches the network. */
export class DryRunDiscord implements DiscordWebhook {
  constructor(private readonly print: (text: string) => void = writeStdout) {}

  execute(payload: DiscordPayload): Promise<number> {
    this.print(
      `${RULE}\n[DRY-RUN] discord webhook embeds=${payload.embeds.length}\n` +
        `${JSON.stringify(payload, null, JSON_INDENT)}\n`,
    );
    return Promise.resolve(0);
  }
}
