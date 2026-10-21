import type { Logger } from '../logger.js';
import { ChatType, type CallbackQuery } from '../telegram/types.js';
import { Denial, type AccessPolicy } from './access.js';
import type { ButtonAction, Press } from './button-actions.js';
import { Action, decodeAction, type DecodedAction } from './callback-data.js';
import { ConfirmCheck, type ConfirmFlow } from './confirmations.js';
import { BACK_TO_SETTINGS } from './menus.js';
import { Toast } from './replies.js';
import { Admission, type ReplyGate } from './reply-gate.js';
import { textScreen, withButtons, type Screen } from './screen.js';

/** Where the result goes: an edit of the pressed message, or a new message. */
export interface Delivery {
  readonly chatId: string;
  readonly screen: Screen;
  readonly editMessageId: number | null;
}

/** The toast is answered at once; the delivery (if any) goes through the reply queue. */
export interface CallbackResult {
  readonly toast: string | null;
  readonly delivery: Delivery | null;
}

export interface CallbackRouterDeps {
  readonly actions: Readonly<Record<string, ButtonAction>>;
  readonly policy: AccessPolicy;
  readonly gate: ReplyGate;
  readonly confirm: ConfirmFlow;
  readonly log: Logger;
}

const BUTTON_CHAT_TYPES: readonly ChatType[] = [
  ChatType.PRIVATE,
  ChatType.GROUP,
  ChatType.SUPERGROUP,
];
const DENIAL_TOASTS: Readonly<Record<Denial, string>> = {
  [Denial.COOLDOWN]: Toast.COOLDOWN,
  [Denial.ADMIN_ONLY]: Toast.ADMIN_ONLY,
  [Denial.STATS_DENIED]: Toast.STATS_DENIED,
};
const ADMISSION_TOASTS: Readonly<Record<Exclude<Admission, 'ok'>, string>> = {
  [Admission.BUSY]: Toast.BUSY,
  [Admission.DUPLICATE]: Toast.DUPLICATE,
};

const toast = (text: string): CallbackResult => ({ toast: text, delivery: null });

/**
 * Handles button presses. Nothing in callback_data is trusted: every press is re-checked for
 * permission, cooldown and reply capacity on the server. Private chats navigate by editing the
 * pressed message; groups get a new message (the menu there is shared). Denials are toasts.
 */
export class CallbackRouter {
  constructor(private readonly deps: CallbackRouterDeps) {}

  handle(callback: CallbackQuery, now: number): CallbackResult {
    const decoded = decodeAction(callback.data);
    const { chatId, messageId } = callback;
    if (!decoded || chatId === null || messageId === null) return toast(Toast.EXPIRED);
    if (!BUTTON_CHAT_TYPES.includes(callback.chatType)) return toast(Toast.EXPIRED);
    const press: Press = {
      userId: callback.fromId,
      chatId,
      chatType: callback.chatType,
      isPrivate: callback.chatType === ChatType.PRIVATE,
      arg: decoded.arg,
      now,
    };
    if (decoded.action === Action.CONFIRM_YES || decoded.action === Action.CONFIRM_NO) {
      return this.confirm(press, decoded, messageId);
    }
    return this.run(press, decoded, messageId);
  }

  private run(press: Press, decoded: DecodedAction, messageId: number): CallbackResult {
    const action = this.deps.actions[decoded.action];
    if (!action) return toast(Toast.EXPIRED);
    const refusal = this.refuse(press, action);
    if (refusal !== null) return refusal;
    const screen = action.build(press);
    if (screen === null) return toast(Toast.EXPIRED);
    this.deps.log.info('button', { action: decoded.action, userId: press.userId });
    const isEdit = press.isPrivate && !action.isAlwaysNew;
    return {
      toast: null,
      delivery: { chatId: press.chatId, screen, editMessageId: isEdit ? messageId : null },
    };
  }

  /** Yakin/Batal: only the initiator, re-checked as admin on Yakin, result edited in place. */
  private confirm(press: Press, decoded: DecodedAction, messageId: number): CallbackResult {
    const checked =
      decoded.arg === null
        ? ConfirmCheck.EXPIRED
        : this.deps.confirm.check(decoded.arg, press, press.now);
    if (checked === ConfirmCheck.EXPIRED) return toast(Toast.EXPIRED);
    if (checked === ConfirmCheck.NOT_YOURS) return toast(Toast.NOT_YOURS);
    const isConfirmed = decoded.action === Action.CONFIRM_YES;
    if (isConfirmed && !this.deps.policy.isAdmin(press.userId)) return toast(Toast.ADMIN_ONLY);
    const admission = this.admit(press, null);
    if (admission !== null) return admission;
    const text = this.deps.confirm.commit(checked, isConfirmed, press.now);
    if (text === null) return toast(Toast.EXPIRED);
    this.deps.log.info('confirmation', { kind: checked.kind, isConfirmed, userId: press.userId });
    const screen = press.isPrivate
      ? withButtons(textScreen(text), [BACK_TO_SETTINGS])
      : textScreen(text);
    return { toast: null, delivery: { chatId: press.chatId, screen, editMessageId: messageId } };
  }

  /** Permission and cooldown, chat type, then reply capacity; null when the press may run. */
  private refuse(press: Press, action: ButtonAction): CallbackResult | null {
    const denial = this.deps.policy.check(action.access, press, press.now);
    if (denial !== null) return toast(DENIAL_TOASTS[denial]);
    if (action.isPrivateOnly && !press.isPrivate) return toast(Toast.PRIVATE_ONLY);
    return this.admit(press, press.isPrivate ? null : (action.viewKey ?? null));
  }

  private admit(press: Press, viewKey: string | null): CallbackResult | null {
    const request = { chatId: press.chatId, isGroup: !press.isPrivate, viewKey };
    const admission = this.deps.gate.admit(request, press.now);
    return admission === Admission.OK ? null : toast(ADMISSION_TOASTS[admission]);
  }
}
