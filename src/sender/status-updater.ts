import type { BlocksRepo } from '../db/blocks-repo.js';
import type { MessagesRepo, StoredMessage } from '../db/messages-repo.js';
import { describeError, type Logger } from '../logger.js';
import { renderDigest, stateOf, type RenderSettings } from '../render/card.js';
import { TelegramApiError, type TelegramApi } from '../telegram/types.js';

export const STATUS_UPDATE_INTERVAL_MS = 5_000;

export interface StatusUpdaterDeps {
  readonly blocks: BlocksRepo;
  readonly messages: MessagesRepo;
  readonly telegram: TelegramApi;
  readonly settings: RenderSettings;
  readonly log: Logger;
  readonly now: () => number;
}

/**
 * Edits an announcement once when all its blocks are final (or orphaned), and immediately when
 * a block in it gets orphaned. Intermediate confirmation counts are not edited.
 */
export class StatusUpdater {
  constructor(private readonly deps: StatusUpdaterDeps) {}

  async tick(): Promise<void> {
    const head = this.deps.blocks.getTip()?.number;
    if (head === undefined) return;
    for (const message of this.deps.messages.listUnsettled()) {
      try {
        await this.refresh(message, head);
      } catch (error) {
        this.deps.log.warn('status edit failed, will retry', {
          messageId: message.telegramMessageId,
          error: describeError(error),
        });
      }
    }
  }

  private async refresh(message: StoredMessage, head: number): Promise<void> {
    const { blocks, messages, telegram, settings, log } = this.deps;
    const cards = blocks.listByMessage(message.id);
    if (cards.length === 0) {
      messages.markSettled(message.id, this.deps.now());
      return;
    }
    const states = cards.map((block) => stateOf(block, head, settings));
    const orphanCount = states.filter((state) => state.kind === 'orphaned').length;
    const isSettled = states.every((state) => state.kind !== 'pending');
    const hasNewOrphans = orphanCount > message.editedOrphanCount;
    if (!isSettled && !hasNewOrphans) return;

    const text = renderDigest(cards, head, settings);
    if (text !== message.lastRenderedText) {
      try {
        await telegram.editMessage(message.chatId, message.telegramMessageId, text);
      } catch (error) {
        if (!(error instanceof TelegramApiError && error.isMessageGone)) throw error;
        log.warn('announcement no longer editable, giving up on it', {
          messageId: message.telegramMessageId,
          error: error.description,
        });
        messages.markSettled(message.id, this.deps.now());
        return;
      }
      log.info('announcement updated', { messageId: message.telegramMessageId, orphanCount });
    }
    messages.recordEdit(message.id, { text, orphanCount, isSettled, now: this.deps.now() });
  }
}
