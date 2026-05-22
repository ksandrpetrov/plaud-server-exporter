/**
 * Central Чайка-style typewriter wrapper for bot replies.
 *
 * Two methods that the dispatcher can use instead of bare `sendMessage` /
 * `editMessageText`:
 *
 *  - `send({ chatId, text, replyMarkup, messageEffectId })` — long messages
 *    are previewed in the user's input field via `sendMessageDraft` (Telegram
 *    natively animates a draft with the same `draftId`, interpolating
 *    smoothly between frames), then delivered as a single `sendMessage` that
 *    stays in chat. Short messages (< `minLen`) and chats where draft is
 *    unavailable fall back to a single `sendMessage` — no in-chat typewriter
 *    via edits, because `editMessageText` is not animated by clients and
 *    looks jumpy.
 *
 *  - `edit({ chatId, messageId, text, replyMarkup, messageEffectId })` —
 *    a single `editMessageText` (instant). Menu navigation should never look
 *    animated: clients don't interpolate edits, so any "typewriter" via
 *    edits is visually worse than a snap.
 *
 * The wiring is opt-in via `ctx.messageAnimator`: if the dispatcher's context
 * has no animator (e.g. in tests) the call sites fall back to a single
 * `sendMessage` / `editMessageText`. Production code in
 * `server/src/telegram/index.js` always creates one.
 */

import { logger } from "../logger.js";
import {
  stableDraftId,
  typewriterDraftAnimate,
} from "./streamingDelivery.js";
import { TypingIndicator } from "./telegramVisual.js";

const DEFAULT_FRAME_MS = 160;
const DEFAULT_MAX_FRAMES = 9;
const DEFAULT_MIN_LEN = 120;

/**
 * @typedef {{
 *   send: (params: {
 *     chatId: number;
 *     text: string;
 *     replyMarkup?: object | null;
 *     messageEffectId?: string | null;
 *   }) => Promise<number | null>;
 *   edit: (params: {
 *     chatId: number;
 *     messageId: number;
 *     text: string;
 *     replyMarkup?: object | null;
 *     messageEffectId?: string | null;
 *   }) => Promise<number | null>;
 * }} MessageAnimator
 */

/**
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   frameMs?: number;
 *   maxFrames?: number;
 *   minLen?: number;
 *   sleep?: (ms: number) => Promise<void>;
 *   nowMs?: () => number;
 * }} params
 * @returns {MessageAnimator}
 */
export function createMessageAnimator({
  telegram,
  frameMs = DEFAULT_FRAME_MS,
  maxFrames = DEFAULT_MAX_FRAMES,
  minLen = DEFAULT_MIN_LEN,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  nowMs = () => Date.now(),
}) {
  return {
    async send({ chatId, text, replyMarkup = null, messageEffectId = null }) {
      const finalText = String(text ?? "");
      if (!finalText) return null;

      if (finalText.length < minLen) {
        return sendDirect({
          telegram,
          chatId,
          text: finalText,
          replyMarkup,
          messageEffectId,
        });
      }

      const typing = new TypingIndicator({ telegram, chatId, nowMs });
      typing.start();
      try {
        const draftId = stableDraftId(chatId, nowMs());
        await typewriterDraftAnimate({
          telegram,
          chatId,
          draftId,
          text: finalText,
          frameMs,
          maxFrames,
          minLen,
          sleep,
        });
        return sendDirect({
          telegram,
          chatId,
          text: finalText,
          replyMarkup,
          messageEffectId,
        });
      } finally {
        typing.stop();
      }
    },

    async edit({ chatId, messageId, text, replyMarkup = null, messageEffectId = null }) {
      if (!messageId) return null;
      const finalText = String(text ?? "");
      if (!finalText) return null;
      try {
        await telegram.editMessageText({
          chatId,
          messageId,
          text: finalText,
          replyMarkup: replyMarkup ?? null,
          messageEffectId: messageEffectId ?? null,
        });
        return messageId;
      } catch (err) {
        logger.info("animator: edit ignored", {
          error: String(err?.message || err),
        });
        return null;
      }
    },
  };
}

async function sendDirect({ telegram, chatId, text, replyMarkup, messageEffectId }) {
  try {
    const res = await telegram.sendMessage({
      chatId,
      text,
      replyMarkup: replyMarkup ?? null,
      messageEffectId: messageEffectId ?? null,
    });
    const mid = Number(res?.message_id);
    return Number.isInteger(mid) ? mid : null;
  } catch (err) {
    logger.warn("animator: sendMessage failed", {
      error: String(err?.message || err),
    });
    return null;
  }
}
