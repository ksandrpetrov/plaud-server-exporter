/**
 * Sync execution bridge: session loading and silent sync (no Telegram UI).
 */

import { logger } from "../../logger.js";
import { createPlaudSessionLoader } from "../../auth/loadPlaudSession.js";
import { redactError } from "../../security/redact.js";
import { runSync } from "../../sync/syncRunner.js";
import {
  classifySyncFailure,
  mapSyncFailureToBotOutcome,
  recordAuthFailureIfNeeded,
} from "../../sync/syncFailureMapper.js";
import { SYNC_ACTION_MANUAL, syncRunGuard } from "../syncGuards.js";

export const defaultSessionLoader = createPlaudSessionLoader("syncRunBridge");

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
  if (
    guardChatId != null &&
    !syncRunGuard.tryAcquire(guardChatId, SYNC_ACTION_MANUAL)
  ) {
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
      const outcome = mapSyncFailureToBotOutcome(failure);
      await recordAuthFailureIfNeeded(failure, err);
      if (outcome.logLevel === "info") {
        logger.info(outcome.logMessage);
      } else {
        logger.error(outcome.logMessage, redactError(err));
      }
      return { status: outcome.status };
    }
  } finally {
    if (guardChatId != null) {
      syncRunGuard.release(guardChatId, SYNC_ACTION_MANUAL, { sent: sentOk });
    }
  }
}
