/**
 * Central GPT-style typewriter for every bot reply.
 *
 * Wraps a `TelegramClient` in two methods that the dispatcher can use instead
 * of bare `sendMessage` / `editMessageText`:
 *
 *  - `send({ chatId, text, replyMarkup, messageEffectId })` — sends a tiny
 *    placeholder, then animates the final text in growing prefixes via
 *    `editMessageText`. Short messages (< `minLen`) bypass the animation so
 *    toasts and one-line errors stay instant.
 *
 *  - `edit({ chatId, messageId, text, replyMarkup, messageEffectId })` —
 *    animates an existing inline-button message into new text, keeping the
 *    keyboard only on the final frame to avoid flicker.
 *
 * The animator also keeps the chat-header "typing…" indicator alive
 * throughout animation, so the user sees the bot is working even before the
 * first frame lands.
 *
 * The wiring is opt-in via `ctx.messageAnimator`: if the dispatcher's context
 * has no animator (e.g. in tests) the call sites fall back to a single
 * `sendMessage` / `editMessageText`. Production code in
 * `server/src/telegram/index.js` always creates one.
 */

import { logger } from "../logger.js";
import { typewriterReveal } from "./streamingDelivery.js";
import { TypingIndicator } from "./telegramVisual.js";

const DEFAULT_FRAME_MS = 160;
const DEFAULT_MAX_FRAMES = 9;
const DEFAULT_MIN_LEN = 120;
const PLACEHOLDER_HTML = "▌";

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
        try {
          const res = await telegram.sendMessage({
            chatId,
            text: finalText,
            replyMarkup: replyMarkup ?? null,
            messageEffectId: messageEffectId ?? null,
          });
          const mid = Number(res?.message_id);
          return Number.isInteger(mid) ? mid : null;
        } catch (err) {
          logger.warn("animator: short sendMessage failed", {
            error: String(err?.message || err),
          });
          return null;
        }
      }

      const typing = new TypingIndicator({ telegram, chatId, nowMs });
      typing.start();
      try {
        let messageId = null;
        try {
          const res = await telegram.sendMessage({
            chatId,
            text: PLACEHOLDER_HTML,
            replyMarkup: null,
          });
          const mid = Number(res?.message_id);
          messageId = Number.isInteger(mid) ? mid : null;
        } catch (err) {
          logger.warn("animator: placeholder send failed; falling back", {
            error: String(err?.message || err),
          });
          return sendDirect({
            telegram,
            chatId,
            text: finalText,
            replyMarkup,
            messageEffectId,
          });
        }
        if (!messageId) return null;
        return await typewriterReveal({
          telegram,
          chatId,
          messageId,
          text: finalText,
          replyMarkup: replyMarkup ?? null,
          messageEffectId: messageEffectId ?? null,
          frameMs,
          maxFrames,
          sleep,
        });
      } finally {
        typing.stop();
      }
    },

    async edit({ chatId, messageId, text, replyMarkup = null, messageEffectId = null }) {
      if (!messageId) return null;
      const finalText = String(text ?? "");
      if (!finalText) return null;

      if (finalText.length < minLen) {
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
          logger.info("animator: short edit ignored", {
            error: String(err?.message || err),
          });
          return null;
        }
      }

      const typing = new TypingIndicator({ telegram, chatId, nowMs });
      typing.start();
      try {
        return await typewriterReveal({
          telegram,
          chatId,
          messageId,
          text: finalText,
          replyMarkup: replyMarkup ?? null,
          messageEffectId: messageEffectId ?? null,
          frameMs,
          maxFrames,
          sleep,
        });
      } finally {
        typing.stop();
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
    logger.warn("animator: direct fallback send failed", {
      error: String(err?.message || err),
    });
    return null;
  }
}
