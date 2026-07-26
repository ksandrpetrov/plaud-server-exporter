/**
 * Orchestrates `runSync` calls initiated either by a user button tap
 * (`source: "manual"`) or by the internal scheduler (`source: "scheduled"`).
 *
 * Split across:
 *  - `sync/syncRunBridge.js` — session + silent sync
 *  - `sync/syncProgressPresenter.js` — loading / progress / final reveal
 *  - `sync/syncDraftBootstrap.js` — draft open + loading pulse
 *  - `sync/syncProgressChannel.js` — throttled onProgress
 */

import { logger } from "../logger.js";
import { runSync } from "../sync/syncRunner.js";
import {
  buildBackToMenuKeyboard,
  buildSyncFinishedKeyboard,
} from "./keyboards.js";
import {
  SYNC_NO_SESSION_HTML,
  syncSummaryHtml,
  syncSummaryRichMarkdown,
} from "./messages.js";
import { createSyncProgressDelivery } from "./streamingDelivery.js";
import { syncActionKey, syncRunGuard } from "./syncGuards.js";
import { defaultSessionLoader } from "./sync/syncRunBridge.js";
import {
  bootstrapSyncDraftAndPulse,
  LOADING_PULSE_FRAME_MS,
} from "./sync/syncDraftBootstrap.js";
import { createSyncProgressChannel } from "./sync/syncProgressChannel.js";
import { handleSyncError, revealFinal } from "./sync/syncProgressPresenter.js";
import { EFFECT_SPARKLES, privateMessageEffect } from "./telegramVisual.js";

export { defaultSessionLoader, runSyncSilent } from "./sync/syncRunBridge.js";

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   chatId: number;
 *   source: "manual" | "scheduled";
 *   loadingMessageId?: number | null;
 *   sessionLoader?: () => Promise<import("../auth/plaudSessionExtractor.js").PlaudSession | null>;
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

  const delivery = createSyncProgressDelivery({
    telegram,
    chatId,
    loadingMessageId: params.loadingMessageId,
    nowMs,
  });
  const draftId = delivery.draftId;
  const callbackMessageId = params.loadingMessageId ?? null;

  let sentOk = false;
  /** @type {import("./streamingDelivery.js").LoadingPulse | import("./streamingDelivery.js").DraftLoadingPulse | null} */
  let pulse = null;
  try {
    const boot = await bootstrapSyncDraftAndPulse({
      telegram,
      chatId,
      source,
      loadingMessageId: callbackMessageId,
      delivery,
      pulseFrameMs,
    });
    pulse = boot.pulse;
    const { draftLive, messageId } = boot;

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

    const onProgress = createSyncProgressChannel({
      mode: "throttled",
      delivery,
      telegram,
      chatId,
      messageId,
      draftLive,
      nowMs,
      onFirstProgress: () => pulse?.stop(),
    });

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
