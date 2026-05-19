/**
 * Orchestrates `runSync` calls initiated either by a user button tap
 * (`source: "manual"`) or by the internal scheduler (`source: "scheduled"`).
 *
 * Responsibilities:
 *
 * 1. Send (or edit) a loading message so the user sees something within ~1 s.
 * 2. Run `runSync({ session, onProgress })`, throttling progress edits to ≥2 s
 *    to avoid Telegram rate-limiting.
 * 3. Replace the loading message with the final summary message, using safe
 *    user-facing copy on every error class (`SyncLockError`, `PlaudAuthError`,
 *    `PlaudChangedError`, missing session, generic).
 *
 * The orchestrator never throws to its caller: failures are turned into
 * Telegram messages and structured logs. The `runSync` lock guarantees that
 * a scheduled tick can't race with a manual tap and corrupt the index.
 */

import { logger } from "../logger.js";
import {
  assertSnapshotReadyForApi,
  createSessionFromSnapshot,
} from "../auth/plaudSessionExtractor.js";
import { loadSessionSnapshot } from "../auth/sessionStore.js";
import { redactError } from "../security/redact.js";
import { runSync } from "../sync/syncRunner.js";
import {
  classifySyncFailure,
  SYNC_FAILURE_AUTH,
  SYNC_FAILURE_LOCK,
  SYNC_FAILURE_PLAUD_CHANGED,
} from "../sync/syncFailureMapper.js";
import {
  buildBackToMenuKeyboard,
  buildSyncFinishedKeyboard,
} from "./keyboards.js";
import {
  SYNC_AUTH_REJECTED_HTML,
  SYNC_GENERIC_ERROR_HTML,
  SYNC_LOADING_HTML,
  SYNC_LOADING_SCHEDULED_HTML,
  SYNC_LOCK_BUSY_HTML,
  SYNC_NO_SESSION_HTML,
  syncProgressHtml,
  syncSummaryHtml,
} from "./messages.js";

const PROGRESS_THROTTLE_MS = 2000;

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   source: "manual" | "scheduled";
 *   loadingMessageId?: number | null;
 *   sessionLoader?: () => Promise<object | null>;
 *   syncRunner?: typeof runSync;
 *   nowMs?: () => number;
 * }} OrchestratorParams
 */

/**
 * @param {OrchestratorParams} params
 * @returns {Promise<{ status: "ok" | "lock_busy" | "no_session" | "auth_rejected" | "failed"; summaryMessageId?: number }>}
 */
export async function runSyncWithReporting(params) {
  const {
    telegram,
    chatId,
    source,
    sessionLoader = defaultSessionLoader,
    syncRunner = runSync,
    nowMs = () => Date.now(),
  } = params;

  const loadingHtml =
    source === "scheduled" ? SYNC_LOADING_SCHEDULED_HTML : SYNC_LOADING_HTML;
  const messageId = await sendOrEditLoading({
    telegram,
    chatId,
    loadingMessageId: params.loadingMessageId,
    text: loadingHtml,
  });

  const session = await sessionLoader();
  if (!session) {
    await replaceWithFinalMessage({
      telegram,
      chatId,
      messageId,
      text: SYNC_NO_SESSION_HTML,
      keyboard: buildBackToMenuKeyboard(),
    });
    logger.warn("Sync skipped: no Plaud session snapshot", { source });
    return { status: "no_session", summaryMessageId: messageId ?? undefined };
  }

  let lastEditMs = 0;
  const onProgress = (stats) => {
    const now = nowMs();
    if (now - lastEditMs < PROGRESS_THROTTLE_MS) return;
    lastEditMs = now;
    void editProgressBestEffort({ telegram, chatId, messageId, stats });
  };

  const startMs = nowMs();
  let stats;
  try {
    stats = await syncRunner({ session, onProgress });
  } catch (err) {
    return handleSyncError({
      telegram,
      chatId,
      messageId,
      err,
      source,
      durationSec: (nowMs() - startMs) / 1000,
    });
  }

  const summaryText = syncSummaryHtml(stats, {
    source,
    durationSec: (nowMs() - startMs) / 1000,
  });
  const finalMessageId = await replaceWithFinalMessage({
    telegram,
    chatId,
    messageId,
    text: summaryText,
    keyboard: buildSyncFinishedKeyboard(),
  });
  logger.info("Sync reported to Telegram", {
    source,
    chatId,
    new: stats.new,
    updated: stats.updated,
    unchanged: stats.unchanged,
    errors: stats.errors,
  });
  return { status: "ok", summaryMessageId: finalMessageId ?? undefined };
}

async function defaultSessionLoader() {
  const snapshot = await loadSessionSnapshot();
  if (!snapshot) return null;
  try {
    assertSnapshotReadyForApi(snapshot);
    return createSessionFromSnapshot(snapshot);
  } catch (err) {
    logger.warn("Session snapshot present but unusable", {
      error: String(err?.message || err),
    });
    return null;
  }
}

async function sendOrEditLoading({ telegram, chatId, loadingMessageId, text }) {
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

async function editProgressBestEffort({ telegram, chatId, messageId, stats }) {
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

async function replaceWithFinalMessage({
  telegram,
  chatId,
  messageId,
  text,
  keyboard,
}) {
  if (messageId) {
    try {
      await telegram.editMessageText({
        chatId,
        messageId,
        text,
        replyMarkup: keyboard,
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

async function handleSyncError({
  telegram,
  chatId,
  messageId,
  err,
  source,
  durationSec,
}) {
  const failure = classifySyncFailure(err);
  const backToMenu = buildBackToMenuKeyboard();

  if (failure.kind === SYNC_FAILURE_LOCK) {
    await replaceWithFinalMessage({
      telegram,
      chatId,
      messageId,
      text: SYNC_LOCK_BUSY_HTML,
      keyboard: backToMenu,
    });
    logger.info("Sync skipped: lock held by another process", { source });
    return { status: "lock_busy", summaryMessageId: messageId ?? undefined };
  }

  if (failure.kind === SYNC_FAILURE_AUTH) {
    await replaceWithFinalMessage({
      telegram,
      chatId,
      messageId,
      text: SYNC_AUTH_REJECTED_HTML,
      keyboard: backToMenu,
    });
    logger.error("Sync failed: Plaud rejected the session", redactError(err));
    return { status: "auth_rejected", summaryMessageId: messageId ?? undefined };
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
    await replaceWithFinalMessage({
      telegram,
      chatId,
      messageId,
      text: syncSummaryHtml(stats, { source, durationSec }),
      keyboard: backToMenu,
    });
    logger.error("Sync detected Plaud API changes", redactError(err));
    return { status: "failed", summaryMessageId: messageId ?? undefined };
  }

  await replaceWithFinalMessage({
    telegram,
    chatId,
    messageId,
    text: SYNC_GENERIC_ERROR_HTML,
    keyboard: backToMenu,
  });
  logger.error("Sync failed in bot orchestrator", redactError(err));
  return { status: "failed", summaryMessageId: messageId ?? undefined };
}
