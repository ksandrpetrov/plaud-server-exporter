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
 * route through it: long copy shows the native "Thinking…" draft bubble
 * (GPT style), then one `sendMessage` or `editMessageText`. When the
 * animator is absent (e.g. in unit tests that build a minimal `ctx`), both
 * helpers fall back to a single bare Telegram call.
 *
 * Pass `{ animate: false }` to `safeSend` to force the bare path even when an
 * animator is wired in (used for tiny system toasts, e.g. sync busy).
 */

import { logger } from "../logger.js";
import { isRichMessageUnavailable } from "./apiFallback.js";

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

/**
 * Sends a rich-markdown message; falls back to HTML via `safeSend`.
 *
 * @param {HasTelegram} ctx
 * @param {number} chatId
 * @param {string} markdown
 * @param {{ fallbackHtml?: string; replyMarkup?: object | null; messageEffectId?: string | null; animate?: boolean }} [options]
 * @returns {Promise<boolean>} true when rich delivery succeeded
 */
export async function safeSendRich(ctx, chatId, markdown, options = {}) {
  if (typeof ctx.telegram.sendRichMessage !== "function") {
    if (options.fallbackHtml) {
      await safeSend(ctx, chatId, options.fallbackHtml, options);
    }
    return false;
  }
  try {
    await ctx.telegram.sendRichMessage({
      chatId,
      markdown,
      replyMarkup: options.replyMarkup ?? null,
      messageEffectId: options.messageEffectId ?? null,
    });
    return true;
  } catch (err) {
    if (!isRichMessageUnavailable(err)) {
      logger.info("sendRichMessage failed; falling back to HTML", {
        error: String(err?.message || err),
      });
    }
    if (options.fallbackHtml) {
      await safeSend(ctx, chatId, options.fallbackHtml, options);
    }
    return false;
  }
}

/**
 * @param {HasTelegram} ctx
 * @param {{
 *   chatId: number,
 *   messageId: number,
 *   text: string,
 *   keyboard: object | null,
 *   animate?: boolean,
 * }} params
 */
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
      logger.info(
        "animator edit failed; falling back to bare editMessageText",
        {
          error: String(err?.message || err),
        }
      );
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
      show_alert: options.showAlert ? true : undefined,
    });
  } catch (err) {
    logger.info("answerCallbackQuery failed", {
      error: String(err?.message || err),
    });
  }
}

/**
 * Premium inline-screen delivery: delete the callback bubble and send a rich
 * message when the API supports it; otherwise edit the bubble with HTML.
 *
 * @param {HasTelegram} ctx
 * @param {{
 *   chatId: number;
 *   messageId: number;
 *   richMarkdown: string;
 *   fallbackHtml: string;
 *   keyboard?: object | null;
 *   animate?: boolean;
 * }} params
 * @returns {Promise<boolean>} true when rich delivery succeeded
 */
export async function safeCallbackRichScreen(
  ctx,
  { chatId, messageId, richMarkdown, fallbackHtml, keyboard = null, animate }
) {
  if (typeof ctx.telegram.sendRichMessage === "function") {
    try {
      if (typeof ctx.telegram.deleteMessage === "function") {
        await ctx.telegram.deleteMessage({ chatId, messageId });
      }
    } catch (err) {
      logger.debug?.("deleteMessage before rich screen failed", {
        error: String(err?.message || err),
      });
    }
    const ok = await safeSendRich(ctx, chatId, richMarkdown, {
      fallbackHtml,
      replyMarkup: keyboard,
      animate,
    });
    if (ok) return true;
  }
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: fallbackHtml,
    keyboard,
    animate,
  });
  return false;
}
