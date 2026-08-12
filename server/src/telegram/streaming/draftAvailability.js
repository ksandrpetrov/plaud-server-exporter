import { logger } from "../../logger.js";
import { clipTelegramText } from "../messages/format.js";
import { isRichMessageUnavailable } from "../apiFallback.js";
import { clipRichMarkdown } from "../richFormat.js";
import { isDraftUnavailable, isEmptyTextRejected } from "../apiFallback.js";

const MIN_DRAFT_INTERVAL_MS = 280;
const MIN_DRAFT_CHAR_DELTA = 24;

/**
 * @param {string | { html?: string; richMarkdown?: string | null }} payload
 * @returns {{ html: string; richMarkdown: string | null }}
 */
export function normalizeProgressPayload(payload) {
  if (typeof payload === "string") {
    return { html: payload, richMarkdown: null };
  }
  return {
    html: String(payload?.html ?? ""),
    richMarkdown: payload?.richMarkdown ? String(payload.richMarkdown) : null,
  };
}

/**
 * @param {number} chatId
 * @param {number} seed
 * @returns {number}
 */
export function stableDraftId(chatId, seed) {
  const mixed = (chatId * 1_000_003) ^ seed;
  return (mixed % 2_147_483_646) + 1;
}

/**
 * @param {string} text
 * @param {string} lastPushed
 * @param {number} lastDraftMs
 * @param {() => number} nowMs
 * @returns {boolean}
 */
export function shouldPushDraftUpdate(text, lastPushed, lastDraftMs, nowMs) {
  if (text === lastPushed) return false;
  if (!lastPushed) return true;
  const now = nowMs();
  if (text.length - lastPushed.length >= MIN_DRAFT_CHAR_DELTA) return true;
  return now - lastDraftMs >= MIN_DRAFT_INTERVAL_MS;
}

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 * }} params
 */
export async function dismissDraftBubbleBestEffort({ telegram, chatId }) {
  if (typeof telegram.sendMessage !== "function") return;
  try {
    const result = await telegram.sendMessage({
      chatId,
      text: "\u200b",
    });
    const mid = Number(result?.message_id);
    if (
      Number.isInteger(mid) &&
      mid > 0 &&
      typeof telegram.deleteMessage === "function"
    ) {
      try {
        await telegram.deleteMessage({ chatId, messageId: mid });
      } catch (err) {
        logger.debug?.("deleteMessage after draft dismiss ignored", {
          error: String(err?.message || err),
        });
      }
    }
  } catch (err) {
    logger.debug?.("dismissDraftBubble ignored", {
      error: String(err?.message || err),
    });
  }
}

export async function deleteStaleProgressMessage(
  telegram,
  chatId,
  staleMessageId,
  finalMessageId
) {
  const stale = Number(staleMessageId);
  const final = Number(finalMessageId);
  if (!Number.isInteger(stale) || stale <= 0) return;
  if (stale === final) return;
  if (typeof telegram.deleteMessage !== "function") return;
  try {
    await telegram.deleteMessage({ chatId, messageId: stale });
  } catch (err) {
    logger.debug?.("deleteMessage ignored", {
      error: String(err?.message || err),
    });
  }
}

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   draftId: number;
 *   initialMarkdown?: string;
 * }} params
 * @returns {Promise<boolean>}
 */
export async function tryOpenRichDraft({
  telegram,
  chatId,
  draftId,
  initialMarkdown = "",
}) {
  const clipped = clipRichMarkdown(initialMarkdown);
  if (!clipped) return false;
  try {
    await telegram.sendRichMessageDraft({
      chatId,
      draftId,
      markdown: clipped,
    });
    return true;
  } catch (err) {
    if (isRichMessageUnavailable(err)) {
      logger.info("sendRichMessageDraft unavailable at open", {
        error: String(err?.message || err),
      });
      return false;
    }
    logger.debug?.("sendRichMessageDraft open failed", {
      error: String(err?.message || err),
    });
    return false;
  }
}

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   draftId: number;
 *   initialText?: string;
 * }} params
 * @returns {Promise<boolean>}
 */
export async function tryOpenDraft({
  telegram,
  chatId,
  draftId,
  initialText = "",
}) {
  const clipped = clipTelegramText(initialText);
  try {
    await telegram.sendMessageDraft({
      chatId,
      draftId,
      text: clipped,
    });
    return true;
  } catch (err) {
    if (isDraftUnavailable(err)) {
      logger.info("sendMessageDraft unavailable at open", {
        error: String(err?.message || err),
      });
      return false;
    }
    if (clipped === "" && isEmptyTextRejected(err)) {
      logger.info("Empty draft text rejected, retrying with placeholder");
      return tryOpenDraft({
        telegram,
        chatId,
        draftId,
        initialText: "⏳",
      });
    }
    logger.debug?.("sendMessageDraft open failed", {
      error: String(err?.message || err),
    });
    return false;
  }
}

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId: number | null;
 *   text: string;
 *   replyMarkup?: object | null;
 *   messageEffectId?: string | null;
 * }} params
 * @returns {Promise<number | null>}
 */
export async function replaceEditedMessage({
  telegram,
  chatId,
  messageId,
  text,
  replyMarkup,
  messageEffectId,
}) {
  if (messageId) {
    try {
      await telegram.editMessageText({
        chatId,
        messageId,
        text,
        replyMarkup: replyMarkup ?? null,
        messageEffectId: messageEffectId ?? null,
      });
      return messageId;
    } catch (err) {
      logger.info("Final edit failed; sending new message", {
        error: String(err?.message || err),
      });
    }
  }
  try {
    const result = await telegram.sendMessage({
      chatId,
      text,
      replyMarkup: replyMarkup ?? null,
      messageEffectId: messageEffectId ?? null,
    });
    const mid = Number(result?.message_id);
    return Number.isInteger(mid) ? mid : null;
  } catch (err) {
    logger.warn("Failed to send final message", {
      error: String(err?.message || err),
    });
    return null;
  }
}
