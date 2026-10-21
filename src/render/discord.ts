import type { PendingRange } from '../db/discord-repo.js';
import type { StoredBlock } from '../domain/block.js';
import type { DiscordEmbed, DiscordPayload, EmbedField } from '../discord/types.js';
import { renderBadges, type CardBlock, type RenderSettings } from './card.js';
import { formatHashrate, formatThousands } from './format.js';

/** Discord's limits per webhook message. */
export const DISCORD_MAX_EMBEDS = 10;
export const DISCORD_MAX_EMBED_CHARS = 6000;

const COLOR_FINAL = 0x2ecc71;
const COLOR_SKIPPED = 0x95a5a6;
const MS_PER_SECOND = 1000;
const BADGE_SEPARATOR = ' · ';

export type DiscordBlock = CardBlock & Pick<StoredBlock, 'timestamp'>;

/** Inline code. Values are hex strings and numbers, so they never contain a backtick. */
const tick = (value: string): string => `\`${value}\``;

const field = (name: string, value: string, inline = false): EmbedField => ({
  name,
  value,
  ...(inline ? { inline } : {}),
});

/** One embed per final block, with the same data as the Telegram card (hashes in full). */
export function renderBlockEmbed(block: DiscordBlock, settings: RenderSettings): DiscordEmbed {
  const hashrate = block.hashrateHps === null ? 'n/a' : `≈ ${formatHashrate(block.hashrateHps)}`;
  const badges = renderBadges(block, tick);
  return {
    title: `🪙 Mining Reward — Block #${block.number}`,
    ...(badges.length > 0 ? { description: badges.join(BADGE_SEPARATOR) } : {}),
    color: COLOR_FINAL,
    timestamp: new Date(block.timestamp * MS_PER_SECOND).toISOString(),
    fields: [
      field('⛏️ Block', tick(`#${block.number}`), true),
      field('✅ Status', 'Final', true),
      field('💪 Difficulty', tick(formatThousands(block.difficulty)), true),
      field('👛 Wallet', tick(block.miner)),
      field('🔗 Hash', tick(block.hash)),
      field('⬅️ Prev block', tick(block.parentHash)),
      field('🎲 Nonce', tick(block.nonce), true),
      field('⚡ Hashrate', `${tick(hashrate)} (rata-rata ${settings.hashrateWindow} block)`, true),
      field('🧬 MixHash', tick(block.mixHash)),
    ],
  };
}

/** Stands in for the blocks dropped from a backlog that grew past the cap. */
export function renderSkippedEmbed(skipped: PendingRange): DiscordEmbed {
  return {
    title: '⏩ Discord tertinggal',
    description:
      `${formatThousands(skipped.count)} block (#${skipped.from}–#${skipped.to}) ` +
      'tidak diposting satu per satu. Detailnya ada di Telegram.',
    color: COLOR_SKIPPED,
  };
}

/** Characters Discord counts toward its 6000-per-message embed limit. */
export function embedLength(embed: DiscordEmbed): number {
  const fields = embed.fields ?? [];
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

/** Splits items (kept in order) into messages of at most 10 embeds and 6000 embed characters. */
export function groupForDiscord<T>(items: readonly T[], measure: (item: T) => number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let currentLength = 0;
  for (const item of items) {
    const length = measure(item);
    const isFull =
      current.length === DISCORD_MAX_EMBEDS || currentLength + length > DISCORD_MAX_EMBED_CHARS;
    if (current.length > 0 && isFull) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(item);
    currentLength += length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function toPayload(embeds: readonly DiscordEmbed[]): DiscordPayload {
  return { embeds, allowed_mentions: { parse: [] } };
}
