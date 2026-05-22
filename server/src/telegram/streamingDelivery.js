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
import { TypingIndicator } from "./telegramVisual.js";

const MIN_DRAFT_INTERVAL_MS = 280;
const MIN_DRAFT_CHAR_DELTA = 24;
const TELEGRAM_TEXT_LIMIT = 4096;
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

// Aligned with satellite/telegram_bot/streaming_delivery.py (Чайка UX).
export const TYPEWRITER_MIN_LEN = 60;
export const TYPEWRITER_MAX_FRAMES = 9;
export const TYPEWRITER_MIN_CHUNK = 60;
export const TYPEWRITER_FRAME_MS = 160;

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
 * @param {unknown} err
 * @returns {boolean}
 */
function isEmptyTextRejected(err) {
  const text = String(err?.message || err).toLowerCase();
  return EMPTY_TEXT_REJECTED_MARKERS.some((m) => text.includes(m));
}

/**
 * @param {string} text
 * @returns {string}
 */
export function clipTelegramText(text) {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  let cut = TELEGRAM_TEXT_LIMIT - 1;
  for (let i = 0; i < 8; i++) {
    const candidate = safeSliceHtml(text, cut) + "…";
    if (candidate.length <= TELEGRAM_TEXT_LIMIT) return candidate;
    cut = Math.max(0, cut - (candidate.length - TELEGRAM_TEXT_LIMIT) - 4);
  }
  return text.slice(0, TELEGRAM_TEXT_LIMIT);
}

/**
 * Stable, non-zero draft id Telegram uses to animate updates of the same
 * draft. Different sessions must produce different ids, otherwise animations
 * leak between unrelated streams.
 *
 * @param {number} chatId
 * @param {number} seed
 * @returns {number}
 */
export function stableDraftId(chatId, seed) {
  const mixed = (chatId * 1_000_003) ^ seed;
  return (mixed % 2_147_483_646) + 1;
}

/**
 * Opens a draft stream (Thinking… placeholder or initial text), mirroring
 * ``StreamingReply.open`` / ``_try_start_draft`` in Чайка.
 *
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
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

    /**
     * @param {string} text
     */
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

    /**
     * @param {{
     *   text: string;
     *   replyMarkup?: object | null;
     *   messageEffectId?: string | null;
     * }} params
     * @returns {Promise<number | null>}
     */
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
      return replaceLegacy({
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
 * Partial HTML prefixes for draft typewriter animation — mirrors Чайка
 * ``_typewriter_chunks`` (no final full-text frame; finish/sendMessage does that).
 *
 * @param {string} text
 * @param {{ maxFrames?: number; minLen?: number; minChunk?: number }} [options]
 * @returns {string[]}
 */
export function typewriterChunks(text, options = {}) {
  const maxFrames = options.maxFrames ?? TYPEWRITER_MAX_FRAMES;
  const minLen = options.minLen ?? TYPEWRITER_MIN_LEN;
  const minChunk = options.minChunk ?? TYPEWRITER_MIN_CHUNK;
  const clipped = clipTelegramText(text);
  if (!clipped || clipped.length < minLen) return [];
  const targetFrames = Math.min(
    maxFrames,
    Math.max(2, Math.floor(clipped.length / minChunk))
  );
  const step = Math.max(minChunk, Math.floor(clipped.length / targetFrames));
  /** @type {string[]} */
  const chunks = [];
  let cursor = step;
  while (cursor < clipped.length) {
    chunks.push(safeSliceHtml(clipped, cursor));
    cursor += step;
  }
  return chunks;
}

/**
 * Frames for legacy in-chat ``editMessageText`` typewriter (includes final text).
 *
 * @param {string} text
 * @param {{ maxFrames?: number; minLen?: number; minChunk?: number }} [options]
 * @returns {string[]}
 */
export function buildTypewriterFrames(text, options = {}) {
  const clipped = clipTelegramText(text);
  const chunks = typewriterChunks(clipped, options);
  if (!chunks.length) return [clipped];
  if (chunks[chunks.length - 1] !== clipped) {
    chunks.push(clipped);
  }
  return chunks;
}

/**
 * Animates a typewriter through `sendMessageDraft` — Telegram-native smooth
 * interpolation of a draft in the input field, identical to satellite/Чайка
 * ``_run_typewriter``.
 *
 * Unlike `typewriterReveal` (which uses `editMessageText` and looks jumpy
 * because Telegram does not animate edits), this function leans on the
 * built-in draft animation: subsequent `sendMessageDraft` calls with the
 * same `draftId` are interpolated client-side at ~60 fps.
 *
 * Returns `true` if the draft animation ran end-to-end; `false` if the
 * `sendMessageDraft` method is unavailable (caller should skip animation
 * and deliver the final message directly).
 *
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   draftId: number;
 *   text: string;
 *   frameMs?: number;
 *   maxFrames?: number;
 *   minLen?: number;
 *   minChunk?: number;
 *   sleep?: (ms: number) => Promise<void>;
 * }} params
 * @returns {Promise<boolean>}
 */
export async function typewriterDraftAnimate({
  telegram,
  chatId,
  draftId,
  text,
  frameMs = TYPEWRITER_FRAME_MS,
  maxFrames = TYPEWRITER_MAX_FRAMES,
  minLen = TYPEWRITER_MIN_LEN,
  minChunk = TYPEWRITER_MIN_CHUNK,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const clipped = clipTelegramText(text);
  if (!clipped) return false;
  const chunks = typewriterChunks(clipped, { maxFrames, minLen, minChunk });
  if (!chunks.length) return false;
  let lastPushed = "";
  for (const chunk of chunks) {
    if (chunk === lastPushed) continue;
    try {
      await telegram.sendMessageDraft({ chatId, draftId, text: chunk });
      lastPushed = chunk;
    } catch (err) {
      if (isDraftUnavailable(err)) {
        logger.info("typewriterDraftAnimate: draft unavailable, skipping", {
          error: String(err?.message || err),
        });
        return false;
      }
      logger.debug?.("typewriterDraftAnimate: frame failed", {
        error: String(err?.message || err),
      });
      return false;
    }
    if (frameMs > 0) await sleep(frameMs);
  }
  return true;
}

/**
 * Чайка-style draft preview in the user's input field before a final
 * `sendMessage` or `editMessageText`. Returns whether draft frames ran.
 *
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   text: string;
 *   draftId?: number;
 *   frameMs?: number;
 *   maxFrames?: number;
 *   minLen?: number;
 *   minChunk?: number;
 *   sleep?: (ms: number) => Promise<void>;
 *   nowMs?: () => number;
 *   withTyping?: boolean;
 * }} params
 * @returns {Promise<boolean>}
 */
export async function runDraftTypewriterPreview({
  telegram,
  chatId,
  text,
  draftId,
  frameMs = TYPEWRITER_FRAME_MS,
  maxFrames = TYPEWRITER_MAX_FRAMES,
  minLen = TYPEWRITER_MIN_LEN,
  minChunk = TYPEWRITER_MIN_CHUNK,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  nowMs = () => Date.now(),
  withTyping = true,
}) {
  const clipped = clipTelegramText(String(text ?? ""));
  if (!clipped || clipped.length < minLen) return false;

  const typing = withTyping
    ? new TypingIndicator({ telegram, chatId, nowMs })
    : null;
  typing?.start();
  try {
    const resolvedDraftId = draftId ?? stableDraftId(chatId, nowMs());
    await tryOpenDraft({ telegram, chatId, draftId: resolvedDraftId, initialText: "" });
    return await typewriterDraftAnimate({
      telegram,
      chatId,
      draftId: resolvedDraftId,
      text: clipped,
      frameMs,
      maxFrames,
      minLen,
      minChunk,
      sleep,
    });
  } finally {
    typing?.stop();
  }
}

/**
 * Animates the final message by editing it through a sequence of growing
 * HTML prefixes. Best-effort: individual frame failures are swallowed.
 *
 * Note: `editMessageText` is NOT animated by Telegram clients — each frame
 * snaps. Use `typewriterDraftAnimate` for smooth Чайка-style reveal in the
 * input field; this helper remains for legacy/in-chat edit fallback.
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
