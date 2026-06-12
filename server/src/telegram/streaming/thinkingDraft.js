/**
 * Native Telegram "Thinking…" bubble (GPT-style) for long operations.
 *
 * Replaces the legacy `sendChatAction("typing")` indicator and the
 * per-chunk draft typewriter: the bot shows the native thinking placeholder
 * in the draft channel, then pushes the full text once — drafts with the
 * same `draft_id` are animated by the client, so the reveal stays smooth
 * without manual frame slicing.
 *
 * Transport cascade:
 *
 *  1. Bot API 10.1+ — `sendRichMessageDraft` with a `<tg-thinking>` block.
 *  2. Bot API 10.0+ — `sendMessageDraft` with empty text (native placeholder).
 *  3. Older draft API — `⏳` placeholder draft (empty text rejected).
 *  4. No draft API — returns `false`; callers fall back to instant delivery.
 */

import { logger } from "../../logger.js";
import { clipTelegramText } from "../messages/format.js";
import {
  clipRichMarkdown,
  isRichMessageUnavailable,
  RICH_THINKING_MARKDOWN,
} from "../richFormat.js";
import {
  isDraftUnavailable,
  isEmptyTextRejected,
  stableDraftId,
} from "./draftChannel.js";

/** Texts shorter than this skip the thinking preview (instant delivery). */
export const THINKING_PREVIEW_MIN_LEN = 60;
/** How long the thinking bubble stays before the full text is pushed. */
export const THINKING_HOLD_MS = 450;
/** Shorter hold for sync finish reveal (still noticeable). */
export const SYNC_THINKING_HOLD_MS = 300;

/**
 * Shows the native thinking bubble in the chat's draft channel.
 *
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   draftId: number;
 * }} params
 * @returns {Promise<"rich" | "text" | false>} transport that accepted the draft
 */
export async function tryPushThinkingDraft({ telegram, chatId, draftId }) {
  if (typeof telegram.sendRichMessageDraft === "function") {
    try {
      await telegram.sendRichMessageDraft({
        chatId,
        draftId,
        markdown: RICH_THINKING_MARKDOWN,
      });
      return "rich";
    } catch (err) {
      if (!isRichMessageUnavailable(err)) {
        logger.debug?.("Rich thinking draft failed; trying text draft", {
          error: String(err?.message || err),
        });
      }
    }
  }
  try {
    await telegram.sendMessageDraft({ chatId, draftId, text: "" });
    return "text";
  } catch (err) {
    if (isDraftUnavailable(err)) {
      logger.info("sendMessageDraft unavailable for thinking bubble", {
        error: String(err?.message || err),
      });
      return false;
    }
    if (isEmptyTextRejected(err)) {
      logger.info("Empty thinking draft rejected, using placeholder");
      try {
        await telegram.sendMessageDraft({ chatId, draftId, text: "⏳" });
        return "text";
      } catch (placeholderErr) {
        logger.debug?.("Placeholder thinking draft failed", {
          error: String(placeholderErr?.message || placeholderErr),
        });
        return false;
      }
    }
    logger.debug?.("Thinking draft failed", {
      error: String(err?.message || err),
    });
    return false;
  }
}

/**
 * GPT-style preview for a finished reply: thinking bubble → one draft push
 * with the full text → caller delivers the final message (the final
 * `sendMessage` dismisses the draft natively).
 *
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   text: string;
 *   richMarkdown?: string | null;
 *   draftId?: number;
 *   minLen?: number;
 *   holdMs?: number;
 *   skipThinking?: boolean;
 *   sleep?: (ms: number) => Promise<void>;
 *   nowMs?: () => number;
 * }} params
 * @returns {Promise<boolean>} true when the full-text draft frame was pushed
 */
export async function runDraftThinkingPreview({
  telegram,
  chatId,
  text,
  richMarkdown = null,
  draftId,
  minLen = THINKING_PREVIEW_MIN_LEN,
  holdMs = THINKING_HOLD_MS,
  skipThinking = false,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  nowMs = () => Date.now(),
}) {
  const clipped = clipTelegramText(String(text ?? ""));
  if (!clipped || clipped.length < minLen) return false;
  if (skipThinking) return false;

  const resolvedDraftId = draftId ?? stableDraftId(chatId, nowMs());
  const mode = await tryPushThinkingDraft({
    telegram,
    chatId,
    draftId: resolvedDraftId,
  });
  if (!mode) return false;
  if (holdMs > 0) await sleep(holdMs);

  if (mode === "rich" && richMarkdown) {
    try {
      await telegram.sendRichMessageDraft({
        chatId,
        draftId: resolvedDraftId,
        markdown: clipRichMarkdown(richMarkdown),
      });
      return true;
    } catch (err) {
      logger.debug?.("Rich preview push failed; falling back to text draft", {
        error: String(err?.message || err),
      });
    }
  }
  try {
    await telegram.sendMessageDraft({
      chatId,
      draftId: resolvedDraftId,
      text: clipped,
    });
    return true;
  } catch (err) {
    logger.debug?.("Thinking preview push failed", {
      error: String(err?.message || err),
    });
    return false;
  }
}

/**
 * Holds the thinking bubble while `fn` runs (e.g. tree loading). There is no
 * draft-cancel API: the bubble is superseded by whatever the callback
 * delivers (draft preview, message, or edit) or expires on its own.
 *
 * @template T
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   draftId?: number;
 *   fn: () => Promise<T>;
 *   nowMs?: () => number;
 * }} params
 * @returns {Promise<T>}
 */
export async function withThinkingDraft({
  telegram,
  chatId,
  draftId,
  fn,
  nowMs = () => Date.now(),
}) {
  await tryPushThinkingDraft({
    telegram,
    chatId,
    draftId: draftId ?? stableDraftId(chatId, nowMs()),
  });
  return fn();
}
