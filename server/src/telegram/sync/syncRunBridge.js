/**
 * Sync execution bridge: session loading and silent sync (no Telegram UI).
 */

import { logger } from "../../logger.js";
import {
  assertSnapshotReadyForApi,
  createSessionFromSnapshot,
} from "../../auth/plaudSessionExtractor.js";
import { loadSessionSnapshot } from "../../auth/sessionStore.js";
import { redactError } from "../../security/redact.js";
import { runSync } from "../../sync/syncRunner.js";
import {
  classifySyncFailure,
  SYNC_FAILURE_AUTH,
  SYNC_FAILURE_LOCK,
  SYNC_FAILURE_PLAUD_CHANGED,
} from "../../sync/syncFailureMapper.js";
import { SYNC_ACTION_MANUAL, syncRunGuard } from "../syncGuards.js";

export async function defaultSessionLoader() {
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
      if (failure.kind === SYNC_FAILURE_LOCK) {
        logger.info("Silent sync skipped: lock held by another process");
        return { status: "lock_busy" };
      }
      if (failure.kind === SYNC_FAILURE_AUTH) {
        logger.error("Silent sync rejected by Plaud", redactError(err));
        return { status: "auth_rejected" };
      }
      if (failure.kind === SYNC_FAILURE_PLAUD_CHANGED) {
        logger.error(
          "Silent sync detected Plaud API changes",
          redactError(err)
        );
        return { status: "plaud_changed" };
      }
      logger.error("Silent sync failed", redactError(err));
      return { status: "failed" };
    }
  } finally {
    if (guardChatId != null) {
      syncRunGuard.release(guardChatId, SYNC_ACTION_MANUAL, { sent: sentOk });
    }
  }
}
