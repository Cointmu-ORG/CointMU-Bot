import type { BlocksRepo } from '../db/blocks-repo.js';
import type { MessagesRepo } from '../db/messages-repo.js';
import type { Logger } from '../logger.js';
import {
  CARD_SEPARATOR,
  maxCardLength,
  renderDigest,
  stateOf,
  type RenderSettings,
} from '../render/card.js';
import { groupCards } from '../render/split.js';
import type { TelegramApi } from '../telegram/types.js';

/** Cap per tick so a long catch-up is sent in steady slices rather than one huge burst. */
const MAX_BLOCKS_PER_TICK = 200;

export interface SenderDeps {
  readonly blocks: BlocksRepo;
  readonly messages: MessagesRepo;
  readonly telegram: TelegramApi;
  /** Current announcement chat; null means announcements are paused (blocks stay unsent). */
  readonly announceChatId: () => string | null;
  readonly settings: RenderSettings;
  readonly log: Logger;
  readonly now: () => number;
}

/**
 * Announces unsent canonical blocks as digest messages (one card per block, ascending),
 * split between cards to stay under Telegram's length limit.
 */
export class Sender {
  constructor(private readonly deps: SenderDeps) {}

  async tick(): Promise<void> {
    const { blocks, messages, telegram, settings, log } = this.deps;
    const chatId = this.deps.announceChatId();
    if (chatId === null) return;
    const pending = blocks.listUnsent(MAX_BLOCKS_PER_TICK);
    const head = blocks.getTip()?.number;
    if (pending.length === 0 || head === undefined) return;

    const groups = groupCards(
      pending,
      (block) => maxCardLength(block, settings),
      CARD_SEPARATOR.length,
    );
    for (const group of groups) {
      const text = renderDigest(group, head, settings);
      const telegramMessageId = await telegram.sendMessage(chatId, text);
      messages.recordSent({
        chatId,
        telegramMessageId,
        text,
        isSettled: group.every((block) => stateOf(block, head, settings).kind !== 'pending'),
        blockHashes: group.map((block) => block.hash),
        now: this.deps.now(),
      });
      log.info('digest sent', {
        messageId: telegramMessageId,
        blocks: group.length,
        from: group[0]?.number,
        to: group.at(-1)?.number,
      });
    }
  }
}
