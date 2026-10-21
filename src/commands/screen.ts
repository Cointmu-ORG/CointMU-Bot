import type { ReplyMarkup } from '../telegram/types.js';

export interface Button {
  readonly text: string;
  /** callback_data, built with encodeAction (<= 64 bytes). */
  readonly data: string;
}

/** A reply: HTML text plus inline buttons, or a custom reply_markup (e.g. a user picker). */
export interface Screen {
  readonly text: string;
  readonly buttons: readonly (readonly Button[])[];
  readonly replyMarkup?: ReplyMarkup;
}

export function textScreen(text: string): Screen {
  return { text, buttons: [] };
}

export function asScreen(reply: string | Screen): Screen {
  return typeof reply === 'string' ? textScreen(reply) : reply;
}

export function withButtons(screen: Screen, rows: readonly (readonly Button[])[]): Screen {
  return { ...screen, buttons: [...screen.buttons, ...rows] };
}

export function toMarkup(screen: Screen): ReplyMarkup | undefined {
  if (screen.replyMarkup) return screen.replyMarkup;
  if (screen.buttons.length === 0) return undefined;
  return {
    inline_keyboard: screen.buttons.map((row) =>
      row.map((button) => ({ text: button.text, callback_data: button.data })),
    ),
  };
}
