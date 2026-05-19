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
import { classifyError } from "../errors/errorClassifier.js";
import { PlaudAuthError, PlaudChangedError } from "../plaud/errors.js";
import { SyncLockError } from "./runLock.js";

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
  const explicit = Number(error?.exitCode);
  const exitCode =
    Number.isInteger(explicit) && explicit > 0 ? explicit : classified.exitCode || 1;
  return {
    kind: SYNC_FAILURE_OTHER,
    exitCode,
    classified,
  };
}
