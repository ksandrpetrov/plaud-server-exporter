/**
 * Orchestrates `runSync` calls initiated either by a user button tap
 * (`source: "manual"`) or by the internal scheduler (`source: "scheduled"`).
 *
 * Responsibilities:
 *
 * 1. Send (or edit) a loading message so the user sees something within ~1 s.
 * 2. Run `runSync({ session, onProgress })`, throttling progress edits to ≥2 s
 *    to avoid Telegram rate-limiting (draft API when available).
 * 3. Replace the loading message with the final summary message, using safe
 *    user-facing copy on every error class (`SyncLockError`, `PlaudAuthError`,
 *    `PlaudChangedError`, missing session, generic).
 *
 * Caller must acquire `syncRunGuard` before invoking (handlers / scheduler).
 * This module releases the guard in `finally`.
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
  syncLoadingPulseFrames,
  syncProgressHtml,
  syncSummaryHtml,
} from "./messages.js";
import {
  createSyncProgressDelivery,
  LoadingPulse,
  typewriterReveal,
} from "./streamingDelivery.js";
import { SYNC_ACTION_KEY, syncRunGuard } from "./syncGuards.js";
import {
  EFFECT_SPARKLES,
  privateMessageEffect,
  TypingIndicator,
} from "./telegramVisual.js";

const PROGRESS_THROTTLE_MS = 2000;
const LOADING_PULSE_FRAME_MS = 1400;
const TYPEWRITER_FRAME_MS = 550;

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   source: "manual" | "scheduled";
 *   loadingMessageId?: number | null;
 *   sessionLoader?: () => Promise<object | null>;
 *   syncRunner?: typeof runSync;
 *   nowMs?: () => number;
 *   sleep?: (ms: number) => Promise<void>;
 *   pulseFrameMs?: number;
 *   typewriterFrameMs?: number;
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
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    pulseFrameMs = LOADING_PULSE_FRAME_MS,
    typewriterFrameMs = TYPEWRITER_FRAME_MS,
  } = params;

  const loadingHtml =
    source === "scheduled" ? SYNC_LOADING_SCHEDULED_HTML : SYNC_LOADING_HTML;
  const delivery = createSyncProgressDelivery({
    telegram,
    chatId,
    loadingMessageId: params.loadingMessageId,
    nowMs,
  });
  const typing = new TypingIndicator({ telegram, chatId, nowMs });
  typing.start();

  let sentOk = false;
  /** @type {LoadingPulse | null} */
  let pulse = null;
  try {
    const messageId = await sendOrEditLoading({
      telegram,
      chatId,
      loadingMessageId: params.loadingMessageId,
      text: loadingHtml,
    });

    pulse = new LoadingPulse({
      telegram,
      chatId,
      messageId,
      frames: syncLoadingPulseFrames(source),
      frameMs: pulseFrameMs,
    });
    pulse.start();

    const session = await sessionLoader();
    if (!session) {
      pulse.stop();
      await typewriterReveal({
        telegram,
        chatId,
        messageId,
        text: SYNC_NO_SESSION_HTML,
        replyMarkup: buildBackToMenuKeyboard(),
        frameMs: typewriterFrameMs,
        sleep,
      });
      logger.warn("Sync skipped: no Plaud session snapshot", { source });
      return { status: "no_session", summaryMessageId: messageId ?? undefined };
    }

    let lastEditMs = 0;
    let firstProgress = true;
    const onProgress = (stats) => {
      if (firstProgress) {
        firstProgress = false;
        pulse?.stop();
      }
      const now = nowMs();
      if (now - lastEditMs < PROGRESS_THROTTLE_MS) return;
      lastEditMs = now;
      const progressText = syncProgressHtml(stats);
      void delivery.pushProgress(progressText);
      void editProgressBestEffort({ telegram, chatId, messageId, stats });
    };

    const startMs = nowMs();
    let stats;
    try {
      stats = await syncRunner({ session, onProgress });
    } catch (err) {
      pulse?.stop();
      return handleSyncError({
        telegram,
        chatId,
        messageId,
        err,
        source,
        durationSec: (nowMs() - startMs) / 1000,
        delivery,
        sleep,
        typewriterFrameMs,
      });
    }

    pulse.stop();

    const summaryText = syncSummaryHtml(stats, {
      source,
      durationSec: (nowMs() - startMs) / 1000,
    });
    const effectId =
      source === "manual"
        ? privateMessageEffect(EFFECT_SPARKLES, chatId)
        : undefined;

    const revealedId = await typewriterReveal({
      telegram,
      chatId,
      messageId,
      text: summaryText,
      replyMarkup: buildSyncFinishedKeyboard(),
      messageEffectId: effectId ?? null,
      frameMs: typewriterFrameMs,
      sleep,
    });
    const finalMessageId =
      revealedId ??
      (await finishDelivery({
        delivery,
        telegram,
        chatId,
        messageId,
        text: summaryText,
        keyboard: buildSyncFinishedKeyboard(),
        messageEffectId: effectId,
      }));
    logger.info("Sync reported to Telegram", {
      source,
      chatId,
      new: stats.new,
      updated: stats.updated,
      unchanged: stats.unchanged,
      errors: stats.errors,
    });
    sentOk = true;
    return { status: "ok", summaryMessageId: finalMessageId ?? undefined };
  } finally {
    typing.stop();
    pulse?.stop();
    syncRunGuard.release(chatId, SYNC_ACTION_KEY, { sent: sentOk });
  }
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

/**
 * @param {{
 *   sessionLoader?: () => Promise<object | null>;
 *   syncRunner?: typeof runSync;
 *   chatId?: number | null;
 * }} [params]
 */
export async function runSyncSilent({
  sessionLoader = defaultSessionLoader,
  syncRunner = runSync,
  chatId = null,
} = {}) {
  const guardChatId = Number.isInteger(chatId) ? chatId : null;
  if (guardChatId != null && !syncRunGuard.tryAcquire(guardChatId, SYNC_ACTION_KEY)) {
    logger.info("Silent sync skipped: ActionGuard busy or cooldown");
    return { status: "lock_busy" };
  }

  let sentOk = false;
  try {
    const session = await sessionLoader();
    if (!session) {
      logger.warn("Silent sync skipped: no Plaud session snapshot");
      return { status: "no_session" };
    }
    try {
      const stats = await syncRunner({ session });
      logger.info("Silent sync completed", {
        new: stats?.new,
        updated: stats?.updated,
        unchanged: stats?.unchanged,
        errors: stats?.errors,
      });
      sentOk = true;
      return { status: "ok", stats };
    } catch (err) {
      const failure = classifySyncFailure(err);
      if (failure.kind === SYNC_FAILURE_LOCK) {
        logger.info("Silent sync skipped: lock held by another process");
        return { status: "lock_busy" };
      }
      if (failure.kind === SYNC_FAILURE_AUTH) {
        logger.error("Silent sync rejected by Plaud", redactError(err));
        return { status: "auth_rejected" };
      }
      if (failure.kind === SYNC_FAILURE_PLAUD_CHANGED) {
        logger.error("Silent sync detected Plaud API changes", redactError(err));
        return { status: "plaud_changed" };
      }
      logger.error("Silent sync failed", redactError(err));
      return { status: "failed" };
    }
  } finally {
    if (guardChatId != null) {
      syncRunGuard.release(guardChatId, SYNC_ACTION_KEY, { sent: sentOk });
    }
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

async function handleSyncError({
  telegram,
  chatId,
  messageId,
  err,
  source,
  durationSec,
  delivery,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  typewriterFrameMs = TYPEWRITER_FRAME_MS,
}) {
  const failure = classifySyncFailure(err);
  const backToMenu = buildBackToMenuKeyboard();

  const reveal = (text) =>
    typewriterReveal({
      telegram,
      chatId,
      messageId,
      text,
      replyMarkup: backToMenu,
      frameMs: typewriterFrameMs,
      sleep,
    }).then(
      (id) =>
        id ??
        finishDelivery({
          delivery,
          telegram,
          chatId,
          messageId,
          text,
          keyboard: backToMenu,
        })
    );

  if (failure.kind === SYNC_FAILURE_LOCK) {
    await reveal(SYNC_LOCK_BUSY_HTML);
    logger.info("Sync skipped: lock held by another process", { source });
    return { status: "lock_busy", summaryMessageId: messageId ?? undefined };
  }

  if (failure.kind === SYNC_FAILURE_AUTH) {
    await reveal(SYNC_AUTH_REJECTED_HTML);
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
    await reveal(syncSummaryHtml(stats, { source, durationSec }));
    logger.error("Sync detected Plaud API changes", redactError(err));
    return { status: "failed", summaryMessageId: messageId ?? undefined };
  }

  await reveal(SYNC_GENERIC_ERROR_HTML);
  logger.error("Sync failed in bot orchestrator", redactError(err));
  return { status: "failed", summaryMessageId: messageId ?? undefined };
}
