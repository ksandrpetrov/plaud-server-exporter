/**
 * Shared Plaud session loading: OAuth tokens (preferred) or legacy snapshot.
 * Used by CLI, Telegram sync bridge, and live tree read model.
 */

import { config } from "../config/config.js";
import { logger } from "../logger.js";
import {
  createSessionFromOAuth,
  describeOAuthTokens,
  getOAuthAccessToken,
} from "./plaudOAuth.js";
import {
  assertSnapshotReadyForApi,
  createSessionFromSnapshot,
} from "./plaudSessionExtractor.js";
import { configuredAuthMode, withResolvedApiMode } from "./plaudSessionMode.js";
import { loadOAuthTokens } from "./oauthTokenStore.js";
import { loadSessionSnapshot } from "./sessionStore.js";

/**
 * @param {{ logContext?: string; includeSnapshot?: boolean }} [options]
 * @returns {Promise<{
 *   session: import("./plaudSessionExtractor.js").PlaudSession | null;
 *   status: "ok" | "missing" | "invalid";
 *   authSource?: "oauth" | "snapshot" | null;
 *   error?: unknown;
 *   snapshot?: import("./sessionStore.js").SessionSnapshot | null;
 * }>}
 */
export async function loadPlaudSessionFromSnapshotDetailed({
  logContext = "session",
  includeSnapshot = false,
} = {}) {
  const mode = configuredAuthMode();
  const snapshot = await loadSessionSnapshot();
  const oauthTokens = await loadOAuthTokens();

  /** @type {"oauth" | "snapshot" | null} */
  let authSource = null;
  let session = null;
  /** @type {unknown} */
  let error;

  async function tryOAuth() {
    try {
      const oauthSession = await createSessionFromOAuth();
      if (oauthSession) {
        session = withResolvedApiMode(oauthSession);
        authSource = "oauth";
        return true;
      }
    } catch (err) {
      error = err;
      logger.warn(`${logContext}: OAuth session unusable`, {
        error: String(err?.message || err),
      });
    }
    return false;
  }

  async function trySnapshot() {
    if (!snapshot) return false;
    try {
      assertSnapshotReadyForApi(snapshot);
      session = withResolvedApiMode(createSessionFromSnapshot(snapshot));
      authSource = "snapshot";
      return true;
    } catch (err) {
      error = err;
      logger.warn(`${logContext}: session snapshot present but unusable`, {
        error: String(err?.message || err),
      });
      return false;
    }
  }

  if (mode === "oauth") {
    await tryOAuth();
  } else if (mode === "snapshot") {
    await trySnapshot();
  } else {
    if (oauthTokens?.access_token) {
      await tryOAuth();
    }
    if (!session) {
      await trySnapshot();
    }
  }

  if (session) {
    return {
      session,
      status: "ok",
      authSource,
      ...(includeSnapshot ? { snapshot } : {}),
    };
  }

  const hasOAuth = !!oauthTokens?.access_token;
  const hasSnapshot = !!snapshot?.localStorage;

  if (mode === "oauth" && hasOAuth) {
    return {
      session: null,
      status: "invalid",
      authSource: null,
      error,
      ...(includeSnapshot ? { snapshot } : {}),
    };
  }

  if (!hasOAuth && !hasSnapshot) {
    return {
      session: null,
      status: "missing",
      authSource: null,
      ...(includeSnapshot ? { snapshot: null } : {}),
    };
  }

  return {
    session: null,
    status: "invalid",
    authSource: null,
    error,
    ...(includeSnapshot ? { snapshot } : {}),
  };
}

/**
 * @param {{ logContext?: string }} [options]
 * @returns {Promise<import("./plaudSessionExtractor.js").PlaudSession | null>}
 */
async function loadPlaudSessionFromSnapshot(options) {
  const { session } = await loadPlaudSessionFromSnapshotDetailed(options);
  return session;
}

/**
 * Factory for injectable session loaders (sync bridge, live tree, tests).
 *
 * @param {string} logContext
 * @returns {() => Promise<import("./plaudSessionExtractor.js").PlaudSession | null>}
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

/**
 * Status-only helper for CLI `status` command.
 */
export async function describeAuthState() {
  const oauthTokens = await loadOAuthTokens();
  const snapshot = await loadSessionSnapshot();
  const hasOAuthAccess = !!(await getOAuthAccessToken());
  return {
    authMode: configuredAuthMode(),
    apiMode: config.apiMode,
    oauth: {
      ...describeOAuthTokens(oauthTokens),
      accessTokenReady: hasOAuthAccess,
    },
    snapshot: snapshot
      ? { present: true, savedAt: snapshot.savedAt || null }
      : { present: false },
  };
}

export { describeOAuthTokens } from "./plaudOAuth.js";
