/**
 * Single point of truth for "which class of sync failure is this?".
 *
 * Both the CLI (`commandSync`) and the Telegram orchestrator (`handleSyncError`)
 * need the same case analysis on a thrown error: lock held, auth rejected,
 * Plaud API changed, or anything else. Without a shared helper the two
 * call sites have to be updated in lockstep — easy to forget, and they
 * already drifted once.
 *
 * The helper deliberately does NOT format user-facing copy. The CLI logs
 * plain text and the bot sends HTML, so each caller still owns its own
 * messages and keyboards.
 */
import {
  classifyError,
  ERROR_KIND_PLAUD_CHANGED,
} from "../errors/errorClassifier.js";
import { PlaudAuthError, PlaudChangedError } from "../plaud/errors.js";
import { SyncLockError } from "./runLock.js";
import { recordAuthError } from "./syncStatusWriter.js";

export const SYNC_FAILURE_LOCK = "lock_busy";
export const SYNC_FAILURE_AUTH = "auth_rejected";
export const SYNC_FAILURE_PLAUD_CHANGED = "plaud_changed";
export const SYNC_FAILURE_OTHER = "other";

/**
 * @typedef {object} SyncFailure
 * @property {"lock_busy" | "auth_rejected" | "plaud_changed" | "other"} kind
 * @property {number} exitCode CLI-style exit code (1..4)
 * @property {object} [lockInfo] Present when kind === "lock_busy"
 * @property {object} [stats]    Present when kind === "plaud_changed"
 * @property {ReturnType<typeof classifyError>} [classified] Present when kind === "other"
 */

/**
 * Classify a thrown `runSync` error into a small enum of cases the UI cares about.
 *
 * @param {unknown} error
 * @returns {SyncFailure}
 */
export function classifySyncFailure(error) {
  if (error instanceof SyncLockError) {
    return {
      kind: SYNC_FAILURE_LOCK,
      exitCode: 4,
      lockInfo: error.lockInfo || {},
    };
  }
  if (error instanceof PlaudAuthError) {
    return { kind: SYNC_FAILURE_AUTH, exitCode: 2 };
  }
  if (error instanceof PlaudChangedError) {
    return {
      kind: SYNC_FAILURE_PLAUD_CHANGED,
      exitCode: 3,
      stats: error.stats || null,
    };
  }
  const classified = classifyError(error);
  if (classified.kind === ERROR_KIND_PLAUD_CHANGED) {
    return {
      kind: SYNC_FAILURE_PLAUD_CHANGED,
      exitCode: 3,
      stats: /** @type {any} */ (error)?.stats || null,
    };
  }
  const explicit = Number(/** @type {any} */ (error)?.exitCode);
  const exitCode =
    Number.isInteger(explicit) && explicit > 0
      ? explicit
      : classified.exitCode || 1;
  return {
    kind: SYNC_FAILURE_OTHER,
    exitCode,
    classified,
  };
}

/**
 * Persist auth failure to status.json when the classified failure is auth.
 *
 * @param {SyncFailure} failure
 * @param {unknown} error
 */
export async function recordAuthFailureIfNeeded(failure, error) {
  if (failure.kind !== SYNC_FAILURE_AUTH) return;
  const message =
    error instanceof Error ? error.message : String(error ?? "auth rejected");
  await recordAuthError(message);
}

/**
 * @typedef {"lock_busy" | "auth_rejected" | "plaud_changed" | "failed"} SyncBotOutcomeStatus
 */

/**
 * Map a classified sync failure to bot orchestration metadata.
 * Does not format user-facing HTML — callers still own copy and keyboards.
 *
 * @param {SyncFailure} failure
 * @param {{ interactive?: boolean }} [options]
 * @returns {{
 *   status: SyncBotOutcomeStatus;
 *   logLevel: "info" | "error";
 *   logMessage: string;
 * }}
 */
export function mapSyncFailureToBotOutcome(
  failure,
  { interactive = false } = {}
) {
  switch (failure.kind) {
    case SYNC_FAILURE_LOCK:
      return {
        status: "lock_busy",
        logLevel: "info",
        logMessage: "Sync skipped: lock held by another process",
      };
    case SYNC_FAILURE_AUTH:
      return {
        status: "auth_rejected",
        logLevel: "error",
        logMessage: "Sync failed: Plaud rejected the session",
      };
    case SYNC_FAILURE_PLAUD_CHANGED:
      return {
        status: interactive ? "failed" : "plaud_changed",
        logLevel: "error",
        logMessage: "Sync detected Plaud API changes",
      };
    default:
      return {
        status: "failed",
        logLevel: "error",
        logMessage: "Sync failed",
      };
  }
}
