/**
 * Telegram draft API + legacy edit fallback for sync progress.
 */

import { logger } from "../../logger.js";
import { clipTelegramText } from "../messages/format.js";
import { clipRichMarkdown, isRichMessageUnavailable } from "../richFormat.js";
import { TelegramError } from "../telegramClient.js";
import { isDraftUnavailable } from "../apiFallback.js";
import {
  deleteStaleProgressMessage,
  normalizeProgressPayload,
  replaceLegacyMessage,
  shouldPushDraftUpdate,
  stableDraftId,
} from "./draftAvailability.js";

export {
  deleteStaleProgressMessage,
  dismissDraftBubbleBestEffort,
  normalizeProgressPayload,
  replaceLegacyMessage,
  stableDraftId,
  tryOpenDraft,
  tryOpenRichDraft,
} from "./draftAvailability.js";
export { isDraftUnavailable, isEmptyTextRejected } from "../apiFallback.js";

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
  let mode = /** @type {"rich" | "text" | "legacy"} */ ("legacy");
  let draftId = stableDraftId(chatId, seed);
  let legacyMessageId = loadingMessageId;
  let lastDraftMs = 0;
  let lastPushed = "";
  let richDraftFailed = false;
  let textDraftFailed = false;

  return {
    draftId,
    isDraftMode() {
      if (mode === "legacy") return false;
      if (mode === "rich") return !richDraftFailed;
      return !textDraftFailed;
    },
    markRichDraftActive() {
      mode = "rich";
      richDraftFailed = false;
      textDraftFailed = false;
    },
    markDraftActive() {
      mode = "text";
      textDraftFailed = false;
    },
    setLegacyMessageId(id) {
      const mid = Number(id);
      if (Number.isInteger(mid) && mid > 0) legacyMessageId = mid;
    },

    async pushProgress(payload) {
      const { html, richMarkdown } = normalizeProgressPayload(payload);
      if (mode === "rich" && !richDraftFailed && richMarkdown) {
        const clippedRich = clipRichMarkdown(richMarkdown);
        if (
          !shouldPushDraftUpdate(clippedRich, lastPushed, lastDraftMs, nowMs)
        ) {
          return;
        }
        lastPushed = clippedRich;
        lastDraftMs = nowMs();
        try {
          await telegram.sendRichMessageDraft({
            chatId,
            draftId,
            markdown: clippedRich,
          });
          return;
        } catch (err) {
          if (isRichMessageUnavailable(err)) {
            logger.info(
              "sendRichMessageDraft unavailable, falling back to text draft",
              { error: String(err?.message || err) }
            );
            richDraftFailed = true;
            mode = "text";
          } else if (err instanceof TelegramError) {
            logger.debug?.("sendRichMessageDraft update failed", {
              error: err.message,
            });
            return;
          }
        }
      }

      const clipped = clipTelegramText(html);
      if (textDraftFailed || mode === "legacy") {
        await pushLegacy(clipped);
        return;
      }
      if (!shouldPushDraftUpdate(clipped, lastPushed, lastDraftMs, nowMs)) {
        return;
      }
      lastPushed = clipped;
      lastDraftMs = nowMs();
      try {
        await telegram.sendMessageDraft({
          chatId,
          draftId,
          text: clipped,
        });
        mode = "text";
      } catch (err) {
        if (isDraftUnavailable(err)) {
          logger.info("sendMessageDraft unavailable, using legacy delivery", {
            error: String(err?.message || err),
          });
          textDraftFailed = true;
          mode = "legacy";
          await pushLegacy(clipped);
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
      if ((mode === "rich" || mode === "text") && !textDraftFailed) {
        try {
          const result = await telegram.sendMessage({
            chatId,
            text: clipped,
            replyMarkup: replyMarkup ?? null,
            messageEffectId: messageEffectId ?? null,
          });
          const mid = Number(result?.message_id);
          if (Number.isInteger(mid)) {
            await deleteStaleProgressMessage(
              telegram,
              chatId,
              legacyMessageId,
              mid
            );
            return mid;
          }
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
   *   frames: Array<string | { html?: string; richMarkdown?: string | null }>;
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
