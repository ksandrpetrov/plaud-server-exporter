/**
 * Orchestrates `runSync` calls initiated either by a user button tap
 * (`source: "manual"`) or by the internal scheduler (`source: "scheduled"`).
 *
 * Split across:
 *  - `sync/syncRunBridge.js` — session + silent sync
 *  - `sync/syncProgressPresenter.js` — loading / progress / final reveal
 */

import { logger } from "../logger.js";
import { runSync } from "../sync/syncRunner.js";
import {
  buildBackToMenuKeyboard,
  buildSyncFinishedKeyboard,
} from "./keyboards.js";
import {
  SYNC_LOADING_HTML,
  SYNC_LOADING_SCHEDULED_HTML,
  SYNC_NO_SESSION_HTML,
  syncFetchStatusHtml,
  syncLoadingPulseFrames,
  syncProgressHtml,
  syncSummaryHtml,
} from "./messages.js";
import {
  clipTelegramText,
  createSyncProgressDelivery,
  DraftLoadingPulse,
  LoadingPulse,
  tryOpenDraft,
  TYPEWRITER_FRAME_MS,
} from "./streamingDelivery.js";
import { syncActionKey, syncRunGuard } from "./syncGuards.js";
import { defaultSessionLoader } from "./sync/syncRunBridge.js";
import {
  editProgressBestEffort,
  handleSyncError,
  revealFinal,
  sendOrEditLoading,
} from "./sync/syncProgressPresenter.js";
import {
  EFFECT_SPARKLES,
  privateMessageEffect,
  TypingIndicator,
} from "./telegramVisual.js";

export { defaultSessionLoader, runSyncSilent } from "./sync/syncRunBridge.js";

const PROGRESS_THROTTLE_MS = 2000;
const LOADING_PULSE_FRAME_MS = 900;

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
  const fetchStatusHtml = syncFetchStatusHtml(source);
  const delivery = createSyncProgressDelivery({
    telegram,
    chatId,
    loadingMessageId: params.loadingMessageId,
    nowMs,
  });
  const typing = new TypingIndicator({ telegram, chatId, nowMs });
  typing.start();
  const draftId = delivery.draftId;
  const draftLive = await tryOpenDraft({
    telegram,
    chatId,
    draftId,
    initialText: clipTelegramText(fetchStatusHtml),
  });
  if (draftLive) {
    delivery.markDraftActive();
    void delivery.pushProgress(fetchStatusHtml);
  }
  const callbackMessageId = params.loadingMessageId ?? null;

  let sentOk = false;
  /** @type {LoadingPulse | DraftLoadingPulse | null} */
  let pulse = null;
  try {
    let messageId = callbackMessageId;
    if (!draftLive || callbackMessageId) {
      messageId = await sendOrEditLoading({
        telegram,
        chatId,
        loadingMessageId: callbackMessageId,
        text: loadingHtml,
      });
    }

    const pulseFrames = syncLoadingPulseFrames(source);
    pulse = draftLive
      ? new DraftLoadingPulse({
          delivery,
          frames: pulseFrames,
          frameMs: pulseFrameMs,
        })
      : new LoadingPulse({
          telegram,
          chatId,
          messageId,
          frames: pulseFrames,
          frameMs: pulseFrameMs,
        });
    pulse.start();

    const session = await sessionLoader();
    if (!session) {
      pulse.stop();
      await revealFinal({
        telegram,
        chatId,
        messageId,
        draftId,
        text: SYNC_NO_SESSION_HTML,
        keyboard: buildBackToMenuKeyboard(),
        frameMs: typewriterFrameMs,
        sleep,
        delivery,
        editInPlace: Boolean(callbackMessageId),
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
      if (!draftLive) {
        void editProgressBestEffort({ telegram, chatId, messageId, stats });
      }
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
        draftId,
        err,
        source,
        durationSec: (nowMs() - startMs) / 1000,
        delivery,
        sleep,
        typewriterFrameMs,
        editInPlace: Boolean(callbackMessageId),
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

    const finalMessageId = await revealFinal({
      telegram,
      chatId,
      messageId,
      draftId,
      text: summaryText,
      keyboard: buildSyncFinishedKeyboard(),
      messageEffectId: effectId,
      frameMs: typewriterFrameMs,
      sleep,
      delivery,
      editInPlace: Boolean(callbackMessageId),
    });
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
    syncRunGuard.release(chatId, syncActionKey(source), { sent: sentOk });
  }
}
