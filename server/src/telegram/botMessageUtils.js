/**
 * Small helpers shared by the dispatcher in `handlers.js` and the tree-browse
 * flow in `treeBrowse.js`. Both need to send a message or edit an inline
 * keyboard message without ever letting a transient Telegram error escape:
 *
 *  - `safeSend` — `sendMessage`, swallowing errors after a warn log.
 *  - `editToMenuScreen` — `editMessageText`, swallowing errors after an info log.
 *  - `answerBestEffort` — best-effort `answerCallbackQuery` to dismiss the
 *    spinner on inline buttons.
 *
 * The contract: never throw to the caller, never block on Telegram retries.
 */

import { logger } from "../logger.js";

/**
 * @typedef {{ telegram: import("./telegramClient.js").TelegramClient }} HasTelegram
 */

export async function safeSend(ctx, chatId, text, options = {}) {
  try {
    await ctx.telegram.sendMessage({
      chatId,
      text,
      replyMarkup: options.replyMarkup ?? null,
    });
  } catch (err) {
    logger.warn("sendMessage failed", {
      error: String(err?.message || err),
    });
  }
}

export async function editToMenuScreen(ctx, { chatId, messageId, text, keyboard }) {
  try {
    await ctx.telegram.editMessageText({
      chatId,
      messageId,
      text,
      replyMarkup: keyboard,
    });
  } catch (err) {
    logger.info("Edit callback message ignored", {
      error: String(err?.message || err),
    });
  }
}

export async function answerBestEffort(ctx, callback) {
  const id = String(callback?.id || "");
  if (!id) return;
  try {
    await ctx.telegram.answerCallbackQuery({ callbackQueryId: id });
  } catch (err) {
    logger.info("answerCallbackQuery failed", {
      error: String(err?.message || err),
    });
  }
}
