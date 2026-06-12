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
  syncChecklistRichFrames,
  syncLoadingPulseFrames,
  syncProgressHtml,
  syncProgressRichMarkdown,
  syncSummaryHtml,
  syncSummaryRichMarkdown,
} from "./messages.js";
import { RICH_THINKING_MARKDOWN } from "./richFormat.js";
import {
  createSyncProgressDelivery,
  DraftLoadingPulse,
  LoadingPulse,
  tryOpenDraft,
  tryOpenRichDraft,
} from "./streamingDelivery.js";
import { syncActionKey, syncRunGuard } from "./syncGuards.js";
import { defaultSessionLoader } from "./sync/syncRunBridge.js";
import {
  editProgressBestEffort,
  handleSyncError,
  revealFinal,
  sendOrEditLoading,
} from "./sync/syncProgressPresenter.js";
import { EFFECT_SPARKLES, privateMessageEffect } from "./telegramVisual.js";

export { defaultSessionLoader, runSyncSilent } from "./sync/syncRunBridge.js";

const PROGRESS_THROTTLE_MS = 2000;
const PROGRESS_THROTTLE_LARGE_MS = 1500;
const LARGE_SYNC_TOTAL = 50;
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
 * }} OrchestratorParams
 */

/**
 * @param {OrchestratorParams} params
 * @returns {Promise<{ status: "ok" | "lock_busy" | "no_session" | "auth_rejected" | "plaud_changed" | "failed"; summaryMessageId?: number }>}
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
  } = params;

  const loadingHtml =
    source === "scheduled" ? SYNC_LOADING_SCHEDULED_HTML : SYNC_LOADING_HTML;
  const delivery = createSyncProgressDelivery({
    telegram,
    chatId,
    loadingMessageId: params.loadingMessageId,
    nowMs,
  });
  const draftId = delivery.draftId;
  // Open the draft with the native "Thinking…" bubble (replaces the legacy
  // typing indicator); the checklist pulse takes over from there.
  let draftLive = await tryOpenRichDraft({
    telegram,
    chatId,
    draftId,
    initialMarkdown: RICH_THINKING_MARKDOWN,
  });
  if (draftLive) {
    delivery.markRichDraftActive();
  } else {
    draftLive = await tryOpenDraft({
      telegram,
      chatId,
      draftId,
      initialText: "",
    });
    if (draftLive) {
      delivery.markDraftActive();
    }
  }
  const callbackMessageId = params.loadingMessageId ?? null;

  let sentOk = false;
  /** @type {LoadingPulse | DraftLoadingPulse | null} */
  let pulse = null;
  try {
    let messageId = callbackMessageId;
    if (!draftLive) {
      messageId = await sendOrEditLoading({
        telegram,
        chatId,
        loadingMessageId: callbackMessageId,
        text: loadingHtml,
      });
      delivery.setLegacyMessageId(messageId);
    } else if (callbackMessageId) {
      delivery.setLegacyMessageId(callbackMessageId);
    }

    const pulseFramesHtml = syncLoadingPulseFrames(source);
    const pulseFramesRich = syncChecklistRichFrames(source);
    const pulseFrames = pulseFramesHtml.map((html, i) => ({
      html,
      richMarkdown: pulseFramesRich[i] ?? pulseFramesRich.at(-1) ?? null,
    }));
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
          frames: pulseFramesHtml,
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
        sleep,
        delivery,
        editInPlace: Boolean(callbackMessageId),
      });
      logger.warn("Sync skipped: no Plaud session snapshot", { source });
      return { status: "no_session", summaryMessageId: messageId ?? undefined };
    }

    let lastEditMs = 0;
    let firstProgress = true;
    let progressThrottleMs = PROGRESS_THROTTLE_MS;
    const onProgress = (stats) => {
      if (firstProgress) {
        firstProgress = false;
        pulse?.stop();
      }
      const total = Number(stats?.total ?? 0);
      if (total > LARGE_SYNC_TOTAL) {
        progressThrottleMs = PROGRESS_THROTTLE_LARGE_MS;
      }
      const now = nowMs();
      if (now - lastEditMs < progressThrottleMs) return;
      lastEditMs = now;
      const progressText = syncProgressHtml(stats);
      void delivery.pushProgress({
        html: progressText,
        richMarkdown: syncProgressRichMarkdown(stats),
      });
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
        editInPlace: Boolean(callbackMessageId),
      });
    }

    pulse.stop();

    const summaryText = syncSummaryHtml(stats, {
      source,
      durationSec: (nowMs() - startMs) / 1000,
    });
    const summaryRich = syncSummaryRichMarkdown(stats, {
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
      richMarkdown: summaryRich,
      keyboard: buildSyncFinishedKeyboard(),
      messageEffectId: effectId,
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
    pulse?.stop();
    syncRunGuard.release(chatId, syncActionKey(source), { sent: sentOk });
  }
}
