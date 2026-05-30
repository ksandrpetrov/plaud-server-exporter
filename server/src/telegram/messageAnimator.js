/**
 * Central Чайка-style typewriter wrapper for bot replies.
 *
 * Two methods that the dispatcher can use instead of bare `sendMessage` /
 * `editMessageText`:
 *
 *  - `send({ chatId, text, replyMarkup, messageEffectId })` — messages at or
 *    above `minLen` are previewed in the user's input field via
 *    `sendMessageDraft`, then delivered as a single `sendMessage`. Shorter
 *    copy and unavailable draft API fall back to one bare `sendMessage`.
 *
 *  - `edit({ chatId, messageId, text, replyMarkup, messageEffectId })` —
 *    same draft preview for long text, then a single `editMessageText` on the
 *    inline menu bubble (no multi-frame in-chat edits — clients don't
 *    interpolate those smoothly).
 *
 * The wiring is opt-in via `ctx.messageAnimator`: if the dispatcher's context
 * has no animator (e.g. in tests) the call sites fall back to a single
 * `sendMessage` / `editMessageText`. Production code in
 * `server/src/telegram/index.js` always creates one.
 */

import { logger } from "../logger.js";
import { clipTelegramText } from "./messages/format.js";
import {
  runDraftTypewriterPreview,
  TYPEWRITER_FRAME_MS,
  TYPEWRITER_MAX_FRAMES,
  TYPEWRITER_MIN_LEN,
} from "./streamingDelivery.js";

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
  frameMs = TYPEWRITER_FRAME_MS,
  maxFrames = TYPEWRITER_MAX_FRAMES,
  minLen = TYPEWRITER_MIN_LEN,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  nowMs = () => Date.now(),
}) {
  const previewOpts = { telegram, frameMs, maxFrames, minLen, sleep, nowMs };

  return {
    async send({ chatId, text, replyMarkup = null, messageEffectId = null }) {
      const finalText = clipTelegramText(String(text ?? ""));
      if (!finalText) return null;

      await runDraftTypewriterPreview({
        ...previewOpts,
        chatId,
        text: finalText,
      });

      return sendDirect({
        telegram,
        chatId,
        text: finalText,
        replyMarkup,
        messageEffectId,
      });
    },

    async edit({
      chatId,
      messageId,
      text,
      replyMarkup = null,
      messageEffectId = null,
    }) {
      if (!messageId) return null;
      const finalText = clipTelegramText(String(text ?? ""));
      if (!finalText) return null;

      await runDraftTypewriterPreview({
        ...previewOpts,
        chatId,
        text: finalText,
      });

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

async function sendDirect({
  telegram,
  chatId,
  text,
  replyMarkup,
  messageEffectId,
}) {
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
