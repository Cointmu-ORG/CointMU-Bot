import { z } from 'zod';
import {
  ChatType,
  type CallbackQuery,
  type IncomingMessage,
  type SharedUsers,
  type TelegramUpdate,
} from './types.js';

const KNOWN_CHAT_TYPES: readonly string[] = Object.values(ChatType);

const chatSchema = z.object({ id: z.number().int(), type: z.string() });
const messageSchema = z.object({
  chat: chatSchema,
  from: z.object({ id: z.number().int() }).optional(),
  sender_chat: z.object({ id: z.number().int() }).optional(),
  text: z.string().optional(),
  users_shared: z
    .object({
      request_id: z.number().int(),
      users: z.array(z.object({ user_id: z.number().int() })),
    })
    .optional(),
});
const callbackSchema = z.object({
  id: z.string(),
  from: z.object({ id: z.number().int() }),
  // An "inaccessible message" (too old) still has a chat but date 0; either way we may not edit it.
  message: z.object({ message_id: z.number().int(), chat: chatSchema }).optional(),
  data: z.string().optional(),
});
const updateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  channel_post: messageSchema.optional(),
  callback_query: callbackSchema.optional(),
});
const updateIdSchema = z.object({ update_id: z.number().int() });

function toChatType(type: string): ChatType {
  return KNOWN_CHAT_TYPES.includes(type) ? (type as ChatType) : ChatType.UNKNOWN;
}

function toSharedUsers(shared: z.infer<typeof messageSchema>['users_shared']): SharedUsers | null {
  if (!shared) return null;
  return { requestId: shared.request_id, userIds: shared.users.map((u) => String(u.user_id)) };
}

function toIncoming(message: z.infer<typeof messageSchema>): IncomingMessage {
  return {
    chatId: String(message.chat.id),
    chatType: toChatType(message.chat.type),
    fromId: message.from ? String(message.from.id) : null,
    isAnonymous: message.sender_chat !== undefined,
    text: message.text ?? '',
    sharedUsers: toSharedUsers(message.users_shared),
  };
}

function toCallback(callback: z.infer<typeof callbackSchema>): CallbackQuery {
  return {
    id: callback.id,
    fromId: String(callback.from.id),
    chatId: callback.message ? String(callback.message.chat.id) : null,
    chatType: callback.message ? toChatType(callback.message.chat.type) : ChatType.UNKNOWN,
    messageId: callback.message?.message_id ?? null,
    data: callback.data ?? '',
  };
}

/**
 * Parses a getUpdates result leniently: one malformed update must not stall the poller, so it
 * is kept (to advance the offset) with no content. Updates without even an id are dropped.
 */
export function parseUpdates(result: unknown): TelegramUpdate[] {
  const items = Array.isArray(result) ? (result as unknown[]) : [];
  return items.flatMap((item) => {
    const parsed = updateSchema.safeParse(item);
    if (parsed.success) {
      const message = parsed.data.message ?? parsed.data.channel_post;
      const callback = parsed.data.callback_query;
      return [
        {
          updateId: parsed.data.update_id,
          message: message ? toIncoming(message) : null,
          callback: callback ? toCallback(callback) : null,
        },
      ];
    }
    const id = updateIdSchema.safeParse(item);
    return id.success ? [{ updateId: id.data.update_id, message: null, callback: null }] : [];
  });
}
