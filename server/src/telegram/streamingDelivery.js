/**
 * Streaming sync progress via sendMessageDraft with legacy edit fallback
 * (mirrors satellite streaming_delivery.py).
 */

import { logger } from "../logger.js";
import { TelegramError } from "./telegramClient.js";

const MIN_DRAFT_INTERVAL_MS = 280;
const DRAFT_UNAVAILABLE_MARKERS = [
  "sendmessagedraft",
  "method is not found",
  "method not found",
  "unknown method",
  "not implemented",
];

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDraftUnavailable(err) {
  const text = String(err?.message || err).toLowerCase();
  return DRAFT_UNAVAILABLE_MARKERS.some((m) => text.includes(m));
}

/**
 * @param {number} chatId
 * @param {number} seed
 * @returns {number}
 */
function stableDraftId(chatId, seed) {
  const mixed = chatId * 1_000_003 ^ seed;
  return (mixed % 2_147_483_646) + 1;
}

/**
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   loadingMessageId?: number | null;
 *   nowMs?: () => number;
 * }} params
 */
export function createSyncProgressDelivery({
  telegram,
  chatId,
  loadingMessageId = null,
  nowMs = () => Date.now(),
}) {
  const seed = nowMs();
  let mode = /** @type {"draft" | "legacy"} */ ("draft");
  let draftId = stableDraftId(chatId, seed);
  let legacyMessageId = loadingMessageId;
  let lastDraftMs = 0;
  let draftFailed = false;

  return {
    /**
     * @param {string} text
     */
    async pushProgress(text) {
      if (draftFailed) {
        await pushLegacy(text);
        return;
      }
      const now = nowMs();
      if (now - lastDraftMs < MIN_DRAFT_INTERVAL_MS) return;
      lastDraftMs = now;
      try {
        await telegram.sendMessageDraft({
          chatId,
          draftId,
          text,
        });
        mode = "draft";
      } catch (err) {
        if (isDraftUnavailable(err)) {
          logger.info("sendMessageDraft unavailable, using legacy delivery", {
            error: String(err?.message || err),
          });
          draftFailed = true;
          mode = "legacy";
          await pushLegacy(text);
          return;
        }
        if (err instanceof TelegramError) {
          logger.debug?.("sendMessageDraft update failed", {
            error: err.message,
          });
        }
      }
    },

    /**
     * @param {{
     *   text: string;
     *   replyMarkup?: object | null;
     *   messageEffectId?: string | null;
     * }} params
     * @returns {Promise<number | null>}
     */
    async finish({ text, replyMarkup, messageEffectId }) {
      if (mode === "draft" && !draftFailed) {
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
          logger.info("Final send after draft failed; falling back to edit", {
            error: String(err?.message || err),
          });
        }
      }
      return replaceLegacy({
        telegram,
        chatId,
        messageId: legacyMessageId,
        text,
        replyMarkup,
        messageEffectId,
      });
    },
  };

  async function pushLegacy(text) {
    if (legacyMessageId) {
      try {
        await telegram.editMessageText({
          chatId,
          messageId: legacyMessageId,
          text,
          replyMarkup: null,
        });
        return;
      } catch (err) {
        logger.debug?.("Legacy progress edit failed", {
          error: String(err?.message || err),
        });
      }
    }
    try {
      const result = await telegram.sendMessage({ chatId, text, replyMarkup: null });
      const mid = Number(result?.message_id);
      if (Number.isInteger(mid)) legacyMessageId = mid;
    } catch (err) {
      logger.debug?.("Legacy progress send failed", {
        error: String(err?.message || err),
      });
    }
  }
}

/**
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId: number | null;
 *   text: string;
 *   replyMarkup?: object | null;
 *   messageEffectId?: string | null;
 * }} params
 * @returns {Promise<number | null>}
 */
async function replaceLegacy({
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
