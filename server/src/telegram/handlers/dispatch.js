import { logger } from "../../logger.js";
import { answerBestEffort } from "../botMessageUtils.js";
import { ERR_CALLBACK_HANDLER_TOAST } from "../messages/errors.js";
import { routeCallback } from "./callbacks.js";
import { handleMessage } from "./inboundMessages.js";
import { guardAuthorizedPrivateUpdate } from "./privateUpdateGate.js";

/**
 * Each callback handler returns `true` when it has already replied to the
 * callback (so the dispatcher should NOT also call `answerCallbackQuery`)
 * and `false` otherwise.
 *
 * @typedef {(args: {
 *   ctx: HandlerContext;
 *   chatId: number;
 *   messageId: number;
 *   data: string;
 *   callback: object;
 * }) => Promise<boolean>} CallbackHandler
 */

/**
 * @typedef {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   allowedUsername: string;
 *   allowedUserId: number | null;
 *   runManualSync: (params: { chatId: number; loadingMessageId: number | null }) => Promise<unknown>;
 *   runSyncQuiet?: () => Promise<{ status: string }>;
 * }} HandlerContext
 */

/**
 * @param {HandlerContext} ctx
 * @param {object} update
 */
export async function dispatchUpdate(ctx, update) {
  if (update?.message) {
    await handleMessage(ctx, update.message);
    return;
  }
  if (update?.callback_query) {
    await handleCallbackQuery(ctx, update.callback_query);
  }
}

async function handleCallbackQuery(ctx, callback) {
  const chatId = Number(callback?.message?.chat?.id);
  const messageId = Number(callback?.message?.message_id);
  const data = String(callback?.data || "");

  if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) {
    await answerBestEffort(ctx, callback);
    return;
  }
  if (
    !guardAuthorizedPrivateUpdate(
      ctx,
      { chat: callback?.message?.chat, from: callback.from },
      { kind: "callback", chatId, extra: { data } }
    )
  ) {
    await answerBestEffort(ctx, callback);
    return;
  }

  try {
    const answered = await routeCallback(ctx, {
      chatId,
      messageId,
      data,
      callback,
    });
    if (!answered) {
      await answerBestEffort(ctx, callback);
    }
  } catch (err) {
    logger.error("Callback handler failed", {
      data,
      error: String(err?.message || err),
    });
    await answerBestEffort(ctx, callback, {
      text: ERR_CALLBACK_HANDLER_TOAST,
      showAlert: true,
    });
  }
}
