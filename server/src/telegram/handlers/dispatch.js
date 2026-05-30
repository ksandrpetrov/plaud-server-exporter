import { logger } from "../../logger.js";
import {
  isAllowedSender,
  isPrivateChat,
  userIdFromPayload,
  usernameFromPayload,
} from "../auth.js";
import { answerBestEffort } from "../botMessageUtils.js";
import { routeCallback } from "./callbacks.js";
import { handleMessage } from "./messages.js";

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
  if (!isPrivateChat(callback?.message?.chat)) {
    logger.info("Silently ignored non-private callback", {
      chatType: String(callback?.message?.chat?.type || ""),
      chatId,
      data,
    });
    await answerBestEffort(ctx, callback);
    return;
  }
  const allowed = isAllowedSender({
    from: callback.from,
    allowedUserId: ctx.allowedUserId,
    allowedUsername: ctx.allowedUsername,
  });
  if (!allowed) {
    logger.info("Silently ignored callback from foreign sender", {
      userId: userIdFromPayload(callback.from),
      username: usernameFromPayload(callback.from),
      chatId,
      data,
    });
    await answerBestEffort(ctx, callback);
    return;
  }

  let callbackAnswered = false;
  try {
    callbackAnswered = await routeCallback(ctx, {
      chatId,
      messageId,
      data,
      callback,
    });
  } catch (err) {
    logger.error("Callback handler failed", {
      data,
      error: String(err?.message || err),
    });
  } finally {
    if (!callbackAnswered) {
      await answerBestEffort(ctx, callback);
    }
  }
}
