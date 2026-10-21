import type { App } from '../../src/app.js';
import type { Harness } from './harness.js';
import type { RecordedCall } from './mock-telegram.js';

export const OWNER_ID = 77;
export const STRANGER_ID = 9;
export const GROUP_ID = -500;

type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

/** Delivers one message to the bot and returns the replies it sent to that chat. */
export async function say(
  h: Harness,
  app: App,
  message: {
    chatId: number;
    chatType: ChatType;
    fromId?: number;
    text: string;
    senderChatId?: number;
  },
): Promise<string[]> {
  const before = h.telegram.sentTo(String(message.chatId)).length;
  h.telegram.receive(message);
  await app.components.commands?.tick();
  await app.components.commands?.settle();
  return h.telegram.sentTo(String(message.chatId)).slice(before);
}

/** Private message from a user (private chat id equals the user id). */
export function dm(h: Harness, app: App, fromId: number, text: string): Promise<string[]> {
  return say(h, app, { chatId: fromId, chatType: 'private', fromId, text });
}

/** Message from a user in a group. */
export function inGroup(
  h: Harness,
  app: App,
  fromId: number,
  text: string,
  chatId: number = GROUP_ID,
): Promise<string[]> {
  return say(h, app, { chatId, chatType: 'group', fromId, text });
}

/** Issues a claim code and redeems it in a private chat, making `userId` the first admin. */
export async function claimAdmin(h: Harness, app: App, userId: number = OWNER_ID): Promise<void> {
  app.components.claim.issueIfNeeded();
  const code = h.claimCodes().at(-1);
  const [reply] = await dm(h, app, userId, `/claim ${code ?? ''}`);
  if (!reply?.includes('sekarang admin')) throw new Error(`claim failed: ${reply ?? 'no reply'}`);
}

/** Config for a bot started with nothing but BOT_TOKEN. */
export const TOKEN_ONLY = { chatId: null, alertChatId: null, allowedUserIds: [] } as const;

export interface PressResult {
  /** Toast shown to the presser ('' = answered without toast, undefined = not answered). */
  readonly toast: string | undefined;
  readonly sent: RecordedCall[];
  readonly edited: RecordedCall[];
}

/** Presses a button and waits until every resulting reply is delivered. */
export async function press(
  h: Harness,
  app: App,
  button: {
    fromId: number;
    chatId: number;
    chatType: 'private' | 'group' | 'supergroup';
    messageId?: number;
    data: string;
  },
): Promise<PressResult> {
  const sentBefore = h.telegram.callsOf('sendMessage').length;
  const editedBefore = h.telegram.callsOf('editMessageText').length;
  const id = h.telegram.press({ messageId: 1, ...button });
  await app.components.commands?.tick();
  await app.components.commands?.settle();
  return {
    toast: h.telegram.toastFor(id),
    sent: h.telegram.callsOf('sendMessage').slice(sentBefore),
    edited: h.telegram.callsOf('editMessageText').slice(editedBefore),
  };
}

/** callback_data of every inline button in a recorded send/edit, row by row flattened. */
export function buttonData(call: RecordedCall | undefined): string[] {
  const markup = call?.body.reply_markup as
    { inline_keyboard?: { callback_data: string }[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat().map((button) => button.callback_data);
}
