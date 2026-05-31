/**
 * Shared Plaud session loading from the on-disk snapshot.
 * Used by CLI, Telegram sync bridge, and live tree read model.
 */

import { logger } from "../logger.js";
import {
  assertSnapshotReadyForApi,
  createSessionFromSnapshot,
} from "./plaudSessionExtractor.js";
import { loadSessionSnapshot } from "./sessionStore.js";

/**
 * @param {{ logContext?: string; includeSnapshot?: boolean }} [options]
 * @returns {Promise<{
 *   session: object | null;
 *   status: "ok" | "missing" | "invalid";
 *   error?: unknown;
 *   snapshot?: object | null;
 * }>}
 */
export async function loadPlaudSessionFromSnapshotDetailed({
  logContext = "session",
  includeSnapshot = false,
} = {}) {
  const snapshot = await loadSessionSnapshot();
  if (!snapshot) {
    return {
      session: null,
      status: "missing",
      ...(includeSnapshot ? { snapshot: null } : {}),
    };
  }
  try {
    assertSnapshotReadyForApi(snapshot);
    return {
      session: createSessionFromSnapshot(snapshot),
      status: "ok",
      ...(includeSnapshot ? { snapshot } : {}),
    };
  } catch (error) {
    logger.warn(`${logContext}: session snapshot present but unusable`, {
      error: String(error?.message || error),
    });
    return {
      session: null,
      status: "invalid",
      error,
      ...(includeSnapshot ? { snapshot } : {}),
    };
  }
}

/**
 * @param {{ logContext?: string }} [options]
 * @returns {Promise<object | null>}
 */
export async function loadPlaudSessionFromSnapshot(options) {
  const { session } = await loadPlaudSessionFromSnapshotDetailed(options);
  return session;
}

/**
 * Factory for injectable session loaders (sync bridge, live tree, tests).
 *
 * @param {string} logContext
 * @returns {() => Promise<object | null>}
 */
export function createPlaudSessionLoader(logContext) {
  return () => loadPlaudSessionFromSnapshot({ logContext });
}

/**
 * Log a CLI-friendly message when session loading fails.
 *
 * @param {"missing" | "invalid"} status
 * @param {{ missing: string; invalid: string }} messages
 */
export function logCliSessionLoadFailure(status, messages) {
  logger.error(status === "missing" ? messages.missing : messages.invalid);
}
