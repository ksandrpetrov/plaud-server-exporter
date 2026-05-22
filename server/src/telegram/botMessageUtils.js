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
 *
 * If `ctx.messageAnimator` is set (production wiring in
 * `server/src/telegram/index.js`), both `safeSend` and `editToMenuScreen`
 * route through it: long copy is previewed via `sendMessageDraft` in the
 * input field (Чайка/GPT style), then one `sendMessage` or `editMessageText`.
 * When the animator is absent (e.g. in unit tests that build a minimal `ctx`),
 * both helpers fall back to a single bare Telegram call.
 *
 * Pass `{ animate: false }` to `safeSend` to force the bare path even when an
 * animator is wired in (used for tiny system toasts, e.g. sync busy).
 */

import { logger } from "../logger.js";

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   messageAnimator?: import("./messageAnimator.js").MessageAnimator | null;
 * }} HasTelegram
 */

export async function safeSend(ctx, chatId, text, options = {}) {
  const animator = options.animate === false ? null : ctx?.messageAnimator;
  if (animator) {
    try {
      await animator.send({
        chatId,
        text,
        replyMarkup: options.replyMarkup ?? null,
        messageEffectId: options.messageEffectId ?? null,
      });
      return;
    } catch (err) {
      logger.warn("animator send failed; falling back to bare sendMessage", {
        error: String(err?.message || err),
      });
    }
  }
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

export async function editToMenuScreen(
  ctx,
  { chatId, messageId, text, keyboard, animate }
) {
  const animator = animate === false ? null : ctx?.messageAnimator;
  if (animator) {
    try {
      await animator.edit({
        chatId,
        messageId,
        text,
        replyMarkup: keyboard,
      });
      return;
    } catch (err) {
      logger.info("animator edit failed; falling back to bare editMessageText", {
        error: String(err?.message || err),
      });
    }
  }
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

export async function answerBestEffort(ctx, callback, options = {}) {
  const id = String(callback?.id || "");
  if (!id) return;
  try {
    await ctx.telegram.answerCallbackQuery({
      callbackQueryId: id,
      text: options.text ?? undefined,
    });
  } catch (err) {
    logger.info("answerCallbackQuery failed", {
      error: String(err?.message || err),
    });
  }
}
