/**
 * Telegram sync progress UI: loading pulse, thinking preview, final reveal, errors.
 */

import { logger } from "../../logger.js";
import {
  classifySyncFailure,
  mapSyncFailureToBotOutcome,
  recordAuthFailureIfNeeded,
  SYNC_FAILURE_LOCK,
  SYNC_FAILURE_PLAUD_CHANGED,
} from "../../sync/syncFailureMapper.js";
import { buildBackToMenuKeyboard } from "../keyboards.js";
import {
  SYNC_AUTH_REJECTED_HTML,
  SYNC_GENERIC_ERROR_HTML,
  SYNC_LOCK_BUSY_HTML,
  syncProgressHtml,
  syncSummaryHtml,
} from "../messages.js";
import { deleteStaleProgressMessage } from "../streaming/draftChannel.js";
import {
  clipTelegramText,
  runDraftThinkingPreview,
} from "../streamingDelivery.js";
import { redactError } from "../../security/redact.js";
import { isRichMessageUnavailable } from "../richFormat.js";

export async function sendOrEditLoading({
  telegram,
  chatId,
  loadingMessageId,
  text,
}) {
  if (loadingMessageId) {
    try {
      await telegram.editMessageText({
        chatId,
        messageId: loadingMessageId,
        text,
        replyMarkup: null,
      });
      return loadingMessageId;
    } catch (err) {
      logger.info("Edit loading message failed; sending fresh message", {
        error: String(err?.message || err),
      });
    }
  }
  try {
    const result = await telegram.sendMessage({
      chatId,
      text,
    });
    const mid = Number(result?.message_id);
    return Number.isInteger(mid) ? mid : null;
  } catch (err) {
    logger.warn("Failed to send loading message", {
      error: String(err?.message || err),
    });
    return null;
  }
}

export async function editProgressBestEffort({
  telegram,
  chatId,
  messageId,
  stats,
}) {
  if (!messageId) return;
  try {
    await telegram.editMessageText({
      chatId,
      messageId,
      text: syncProgressHtml(stats),
      replyMarkup: null,
    });
  } catch (err) {
    logger.debug?.("Progress edit ignored", {
      error: String(err?.message || err),
    });
  }
}

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId: number | null;
 *   draftId: number;
 *   text: string;
 *   richMarkdown?: string | null;
 *   keyboard?: object | null;
 *   messageEffectId?: string | null;
 *   sleep?: (ms: number) => Promise<void>;
 *   delivery: ReturnType<typeof import("../streamingDelivery.js").createSyncProgressDelivery>;
 *   editInPlace?: boolean;
 * }} params
 * @returns {Promise<number | null>}
 */
export async function revealFinal({
  telegram,
  chatId,
  messageId,
  draftId,
  text,
  richMarkdown = null,
  keyboard = null,
  messageEffectId = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  delivery,
  editInPlace = false,
}) {
  const clipped = clipTelegramText(text);
  // Thinking bubble → one full-text draft frame; the final send below
  // dismisses the draft natively.
  await runDraftThinkingPreview({
    telegram,
    chatId,
    text: clipped,
    richMarkdown,
    draftId,
    sleep,
  });

  if (richMarkdown && typeof telegram.sendRichMessage === "function") {
    try {
      const result = await telegram.sendRichMessage({
        chatId,
        markdown: richMarkdown,
        replyMarkup: keyboard ?? null,
        messageEffectId: messageEffectId ?? null,
      });
      const mid = Number(result?.message_id);
      if (Number.isInteger(mid)) {
        await deleteStaleProgressMessage(telegram, chatId, messageId, mid);
        return mid;
      }
    } catch (err) {
      if (!isRichMessageUnavailable(err)) {
        logger.info("sendRichMessage failed; falling back to HTML delivery", {
          error: String(err?.message || err),
        });
      }
    }
  }

  if (delivery.isDraftMode()) {
    return finishDelivery({
      delivery,
      telegram,
      chatId,
      messageId,
      text: clipped,
      keyboard: keyboard ?? null,
      messageEffectId: messageEffectId ?? null,
    });
  }
  if (messageId && editInPlace) {
    try {
      await telegram.editMessageText({
        chatId,
        messageId,
        text: clipped,
        replyMarkup: keyboard ?? null,
        messageEffectId: messageEffectId ?? null,
      });
      return messageId;
    } catch (err) {
      logger.info("Final edit failed; falling back to delivery", {
        error: String(err?.message || err),
      });
    }
  }
  return finishDelivery({
    delivery,
    telegram,
    chatId,
    messageId,
    text: clipped,
    keyboard: keyboard ?? null,
    messageEffectId: messageEffectId ?? null,
  });
}

async function finishDelivery({
  delivery,
  telegram,
  chatId,
  messageId,
  text,
  keyboard,
  messageEffectId,
}) {
  const id = await delivery.finish({
    text,
    replyMarkup: keyboard ?? null,
    messageEffectId: messageEffectId ?? null,
  });
  if (id != null) return id;
  return replaceWithFinalMessage({
    telegram,
    chatId,
    messageId,
    text,
    keyboard,
    messageEffectId,
  });
}

async function replaceWithFinalMessage({
  telegram,
  chatId,
  messageId,
  text,
  keyboard,
  messageEffectId,
}) {
  if (messageId) {
    try {
      await telegram.editMessageText({
        chatId,
        messageId,
        text,
        replyMarkup: keyboard,
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
      replyMarkup: keyboard,
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
 * @returns {Promise<{
 *   status: "lock_busy" | "auth_rejected" | "plaud_changed" | "failed";
 *   summaryMessageId?: number
 * }>}
 */
export async function handleSyncError({
  telegram,
  chatId,
  messageId,
  draftId,
  err,
  source,
  durationSec,
  delivery,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  editInPlace = false,
}) {
  const failure = classifySyncFailure(err);
  const outcome = mapSyncFailureToBotOutcome(failure, { interactive: true });
  const backToMenu = buildBackToMenuKeyboard();

  const reveal = (text) =>
    revealFinal({
      telegram,
      chatId,
      messageId,
      draftId,
      text,
      keyboard: backToMenu,
      sleep,
      delivery,
      editInPlace,
    });

  if (failure.kind === SYNC_FAILURE_LOCK) {
    await reveal(SYNC_LOCK_BUSY_HTML);
    logger.info(outcome.logMessage, { source });
    return { status: outcome.status, summaryMessageId: messageId ?? undefined };
  }

  if (failure.kind === SYNC_FAILURE_PLAUD_CHANGED) {
    const stats = failure.stats || {
      new: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
      plaudChanged: true,
    };
    await reveal(syncSummaryHtml(stats, { source, durationSec }));
    logger.error(outcome.logMessage, redactError(err));
    return { status: outcome.status, summaryMessageId: messageId ?? undefined };
  }

  if (outcome.status === "auth_rejected") {
    await recordAuthFailureIfNeeded(failure, err);
    await reveal(SYNC_AUTH_REJECTED_HTML);
    logger.error(outcome.logMessage, redactError(err));
    return {
      status: outcome.status,
      summaryMessageId: messageId ?? undefined,
    };
  }

  await reveal(SYNC_GENERIC_ERROR_HTML);
  logger.error(outcome.logMessage, redactError(err));
  return { status: outcome.status, summaryMessageId: messageId ?? undefined };
}
