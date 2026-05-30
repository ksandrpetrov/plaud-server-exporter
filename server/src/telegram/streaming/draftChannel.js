/**
 * Telegram draft API + legacy edit fallback for sync progress.
 */

import { logger } from "../../logger.js";
import { clipTelegramText } from "../messages/format.js";
import { TelegramError } from "../telegramClient.js";

const MIN_DRAFT_INTERVAL_MS = 280;
const MIN_DRAFT_CHAR_DELTA = 24;

const DRAFT_UNAVAILABLE_MARKERS = [
  "sendmessagedraft",
  "textdraft",
  "method is not found",
  "method not found",
  "unknown method",
  "not implemented",
];

const EMPTY_TEXT_REJECTED_MARKERS = [
  "text is empty",
  "message text is empty",
  "text must be non-empty",
];

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isDraftUnavailable(err) {
  const text = String(/** @type {any} */ (err)?.message || err).toLowerCase();
  return DRAFT_UNAVAILABLE_MARKERS.some((m) => text.includes(m));
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isEmptyTextRejected(err) {
  const text = String(/** @type {any} */ (err)?.message || err).toLowerCase();
  return EMPTY_TEXT_REJECTED_MARKERS.some((m) => text.includes(m));
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
export async function replaceLegacyMessage({
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

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
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
  let mode = /** @type {"draft" | "legacy"} */ ("legacy");
  let draftId = stableDraftId(chatId, seed);
  let legacyMessageId = loadingMessageId;
  let lastDraftMs = 0;
  let lastPushed = "";
  let draftFailed = false;

  return {
    draftId,
    isDraftMode() {
      return mode === "draft" && !draftFailed;
    },
    markDraftActive() {
      mode = "draft";
      draftFailed = false;
    },

    async pushProgress(text) {
      const clipped = clipTelegramText(text);
      if (draftFailed) {
        await pushLegacy(clipped);
        return;
      }
      if (!shouldPushDraft(clipped)) return;
      lastPushed = clipped;
      const now = nowMs();
      lastDraftMs = now;
      try {
        await telegram.sendMessageDraft({
          chatId,
          draftId,
          text: clipped,
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

    async finish({ text, replyMarkup, messageEffectId }) {
      const clipped = clipTelegramText(text);
      if (mode === "draft" && !draftFailed) {
        try {
          const result = await telegram.sendMessage({
            chatId,
            text: clipped,
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
      return replaceLegacyMessage({
        telegram,
        chatId,
        messageId: legacyMessageId,
        text: clipped,
        replyMarkup,
        messageEffectId,
      });
    },
  };

  function shouldPushDraft(text) {
    if (text === lastPushed) return false;
    if (!lastPushed) return true;
    const now = nowMs();
    if (text.length - lastPushed.length >= MIN_DRAFT_CHAR_DELTA) return true;
    return now - lastDraftMs >= MIN_DRAFT_INTERVAL_MS;
  }

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
      const result = await telegram.sendMessage({
        chatId,
        text,
        replyMarkup: null,
      });
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
 * Cycles loading frames through the draft stream (Чайка draft-only path).
 */
export class DraftLoadingPulse {
  /**
   * @param {{
   *   delivery: ReturnType<typeof createSyncProgressDelivery>;
   *   frames: string[];
   *   frameMs?: number;
   * }} params
   */
  constructor({ delivery, frames, frameMs = 1400 }) {
    this._delivery = delivery;
    this._frames = frames.length > 0 ? frames : null;
    this._frameMs = frameMs;
    this._timer = null;
    this._idx = 0;
    this._stopped = true;
  }

  start() {
    if (!this._frames) return;
    this._stopped = false;
    void this._delivery.pushProgress(this._frames[0]);
    this._timer = setInterval(() => {
      if (this._stopped) return;
      this._idx = (this._idx + 1) % this._frames.length;
      void this._delivery.pushProgress(this._frames[this._idx]);
    }, this._frameMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  stop() {
    this._stopped = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
