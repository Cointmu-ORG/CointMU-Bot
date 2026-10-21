export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export class OversizedCardError extends Error {
  override name = 'OversizedCardError';
}

/**
 * Groups items (kept in order) so that the joined cards of each group fit in `maxLength`.
 * Splits only between cards, never inside one. `measure` returns a card's length.
 */
export function groupCards<T>(
  items: readonly T[],
  measure: (item: T) => number,
  separatorLength: number,
  maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let currentLength = 0;
  for (const item of items) {
    const length = measure(item);
    if (length > maxLength) {
      throw new OversizedCardError(`card of ${length} chars exceeds the ${maxLength} limit`);
    }
    const lengthWithItem = current.length === 0 ? length : currentLength + separatorLength + length;
    if (lengthWithItem > maxLength) {
      groups.push(current);
      current = [item];
      currentLength = length;
    } else {
      current.push(item);
      currentLength = lengthWithItem;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
