/**
 * Streaming sync progress via sendMessageDraft with legacy edit fallback
 * (mirrors satellite streaming_delivery.py).
 *
 * Plus an in-chat typewriter reveal that animates the final message via
 * `editMessageText` so the user sees a ChatGPT-style fill-in, independent of
 * Bot API draft support.
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

const TYPEWRITER_MIN_LEN = 40;
const TYPEWRITER_MAX_FRAMES = 7;
const TYPEWRITER_FRAME_MS = 650;
const TYPEWRITER_CARET = " ▌";

const HTML_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?>/g;

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
 * Closes any HTML tags still open in `html`, so a partial slice stays valid.
 *
 * @param {string} html
 * @returns {string}
 */
function closeOpenHtmlTags(html) {
  const stack = [];
  HTML_TAG_RE.lastIndex = 0;
  let match;
  while ((match = HTML_TAG_RE.exec(html))) {
    const closing = match[1];
    const tag = match[2].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === tag) {
          stack.splice(i, 1);
          break;
        }
      }
    } else if (!isSelfClosingTag(tag)) {
      stack.push(tag);
    }
  }
  if (!stack.length) return html;
  let trailer = "";
  for (let i = stack.length - 1; i >= 0; i--) {
    trailer += `</${stack[i]}>`;
  }
  return html + trailer;
}

function isSelfClosingTag(tag) {
  return tag === "br" || tag === "hr" || tag === "img";
}

/**
 * Returns an HTML-safe prefix of `text` of length ≤ `length`, never cutting
 * inside a tag or entity. Adds closing tags for anything still open.
 *
 * @param {string} text
 * @param {number} length
 * @returns {string}
 */
export function safeSliceHtml(text, length) {
  if (length >= text.length) return text;
  if (length <= 0) return "";
  let cut = length;
  const lastLt = text.lastIndexOf("<", cut - 1);
  const lastGt = text.lastIndexOf(">", cut - 1);
  if (lastLt > lastGt) cut = lastLt;
  const lastAmp = text.lastIndexOf("&", cut - 1);
  const lastSemi = text.lastIndexOf(";", cut - 1);
  if (lastAmp > lastSemi && cut - lastAmp <= 10) cut = lastAmp;
  if (cut <= 0) return "";
  return closeOpenHtmlTags(text.slice(0, cut));
}

/**
 * Builds progressively-growing HTML prefixes for the typewriter reveal.
 * The first frame is roughly 1/maxFrames of the text, the last is full text.
 *
 * @param {string} text
 * @param {{ maxFrames?: number; minLen?: number; caret?: string }} [options]
 * @returns {string[]}
 */
export function buildTypewriterFrames(text, options = {}) {
  const maxFrames = options.maxFrames ?? TYPEWRITER_MAX_FRAMES;
  const minLen = options.minLen ?? TYPEWRITER_MIN_LEN;
  const caret = options.caret ?? TYPEWRITER_CARET;
  if (!text || text.length < minLen) return [text];
  const step = Math.max(30, Math.floor(text.length / maxFrames));
  /** @type {string[]} */
  const frames = [];
  let cursor = step;
  while (cursor < text.length && frames.length < maxFrames - 1) {
    const slice = safeSliceHtml(text, cursor);
    if (slice && slice !== frames[frames.length - 1]) {
      frames.push(slice + caret);
    }
    cursor += step;
  }
  frames.push(text);
  return frames;
}

/**
 * Animates the final message by editing it through a sequence of growing
 * HTML prefixes. Best-effort: individual frame failures are swallowed.
 *
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId: number | null;
 *   text: string;
 *   replyMarkup?: object | null;
 *   messageEffectId?: string | null;
 *   frameMs?: number;
 *   maxFrames?: number;
 *   sleep?: (ms: number) => Promise<void>;
 * }} params
 * @returns {Promise<number | null>}
 */
export async function typewriterReveal({
  telegram,
  chatId,
  messageId,
  text,
  replyMarkup = null,
  messageEffectId = null,
  frameMs = TYPEWRITER_FRAME_MS,
  maxFrames = TYPEWRITER_MAX_FRAMES,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!messageId) return null;
  const frames = buildTypewriterFrames(text, { maxFrames });
  for (let i = 0; i < frames.length - 1; i++) {
    try {
      await telegram.editMessageText({
        chatId,
        messageId,
        text: frames[i],
        replyMarkup: null,
      });
    } catch (err) {
      logger.debug?.("Typewriter frame edit failed", {
        error: String(err?.message || err),
      });
    }
    if (frameMs > 0) await sleep(frameMs);
  }
  try {
    await telegram.editMessageText({
      chatId,
      messageId,
      text: frames[frames.length - 1],
      replyMarkup: replyMarkup ?? null,
      messageEffectId: messageEffectId ?? null,
    });
    return messageId;
  } catch (err) {
    logger.info("Typewriter final edit failed", {
      error: String(err?.message || err),
    });
    return null;
  }
}

/**
 * Keeps the loading message visually alive by cycling through animation
 * frames via `editMessageText`. Stop before swapping the message into
 * progress/final state.
 */
export class LoadingPulse {
  /**
   * @param {{
   *   telegram: import("./telegramClient.js").TelegramClient;
   *   chatId: number;
   *   messageId: number | null;
   *   frames: string[];
   *   frameMs?: number;
   * }} params
   */
  constructor({ telegram, chatId, messageId, frames, frameMs = 1400 }) {
    this._telegram = telegram;
    this._chatId = chatId;
    this._messageId = messageId;
    this._frames = frames.length > 0 ? frames : null;
    this._frameMs = frameMs;
    this._timer = null;
    this._idx = 0;
    this._inflight = false;
    this._stopped = true;
  }

  start() {
    if (!this._frames || !this._messageId) return;
    this._stopped = false;
    this._timer = setInterval(() => {
      void this._tick();
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

  async _tick() {
    if (this._stopped || this._inflight) return;
    this._inflight = true;
    this._idx = (this._idx + 1) % this._frames.length;
    const text = this._frames[this._idx];
    try {
      await this._telegram.editMessageText({
        chatId: this._chatId,
        messageId: this._messageId,
        text,
        replyMarkup: null,
      });
    } catch {
      // best-effort
    } finally {
      this._inflight = false;
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
