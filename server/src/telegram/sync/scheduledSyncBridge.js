/**
 * Scheduled sync orchestration: visible reporting vs silent autosync.
 */

import { logger } from "../../logger.js";
import { syncBusyText } from "../messages.js";
import {
  SYNC_ACTION_SCHEDULED,
  syncActionKey,
  syncRunGuard,
} from "../syncGuards.js";

/**
 * @param {{
 *   chatId: number;
 *   scheduledSummaryVisible: boolean;
 *   runSyncWithReporting: (args: {
 *     chatId: number;
 *     loadingMessageId: null;
 *     source: "scheduled";
 *   }) => Promise<unknown>;
 *   runSyncSilent: (args: { chatId: null }) => Promise<{ status?: string }>;
 *   messageAnimator: { send: (args: { chatId: number; text: string }) => Promise<unknown> };
 * }} params
 */
export async function runScheduledSync({
  chatId,
  scheduledSummaryVisible,
  runSyncWithReporting,
  runSyncSilent,
  messageAnimator,
}) {
  if (!syncRunGuard.tryAcquire(chatId, SYNC_ACTION_SCHEDULED)) {
    logger.info(
      "Skipping scheduled sync — ActionGuard busy or post-success cooldown"
    );
    if (!scheduledSummaryVisible) return;
    try {
      await messageAnimator.send({
        chatId,
        text: syncBusyText("scheduled"),
      });
    } catch (err) {
      logger.debug?.("Scheduled sync busy notice failed", {
        error: String(err?.message || err),
      });
    }
    return;
  }
  if (scheduledSummaryVisible) {
    return runSyncWithReporting({
      chatId,
      loadingMessageId: null,
      source: "scheduled",
    });
  }
  let sentOk = false;
  try {
    const result = await runSyncSilent({ chatId: null });
    sentOk = result?.status === "ok";
    return result;
  } finally {
    syncRunGuard.release(chatId, syncActionKey("scheduled"), {
      sent: sentOk,
    });
  }
}
