/**
 * Typewriter animation for Telegram drafts and legacy edit fallback.
 */

import { logger } from "../../logger.js";
import { clipTelegramText, safeSliceHtml } from "../messages/format.js";
import { TypingIndicator } from "../telegramVisual.js";
import {
  isDraftUnavailable,
  stableDraftId,
  tryOpenDraft,
} from "./draftChannel.js";

export const TYPEWRITER_MIN_LEN = 60;
export const TYPEWRITER_MAX_FRAMES = 9;
export const TYPEWRITER_MIN_CHUNK = 60;
export const TYPEWRITER_FRAME_MS = 160;

/**
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
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
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
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
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
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
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
