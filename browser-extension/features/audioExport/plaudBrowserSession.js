import { createSessionReader } from "./plaudSessionReader.js";
import {
  currentStorageSnapshot,
  readPageStorageSnapshot,
} from "./plaudSessionStorage.js";
export {
  parseStoredValue,
  normalizeBearerToken,
  decodeJwtSubject,
  normalizeApiBase,
} from "./plaudSessionReader.js";

/** @param {string} key */
export function getScopedStorageValue(key) {
  return createSessionReader(currentStorageSnapshot()).getScopedStorageValue(
    key
  );
}
/** @param {string} [userId] */
export function getPlaudApiBase(userId) {
  return createSessionReader(currentStorageSnapshot()).getPlaudApiBase(userId);
}
export function describePlaudSessionStorage() {
  return createSessionReader(
    currentStorageSnapshot()
  ).describePlaudSessionStorage(
    typeof window !== "undefined" ? window.location?.origin || "" : ""
  );
}

/**
 * @typedef {{
 *   apiBase: string;
 *   authHeader: string;
 *   userAuthHeader: string;
 *   workspaceAuthHeader: string;
 *   workspaceId: string;
 *   sortBy: string;
 *   tokenSource?: string;
 * }} PlaudBrowserSession
 */

/** @returns {Promise<PlaudBrowserSession>} */
export async function getPlaudSession() {
  const snapshot = currentStorageSnapshot();
  let reader = createSessionReader(snapshot);
  if (!reader.hasUserToken()) {
    const page = await readPageStorageSnapshot();
    if (page)
      reader = createSessionReader({
        localStorage: { ...snapshot.localStorage, ...page.localStorage },
        sessionStorage: { ...snapshot.sessionStorage, ...page.sessionStorage },
      });
  }
  return reader.resolveSession();
}

/**
 * @param {PlaudBrowserSession} session
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Record<string, string>}
 */
export function buildPlaudHeaders(session, extraHeaders = {}) {
  const headers = {
    Authorization: session.authHeader,
    "edit-from": "web",
    "app-platform": "web",
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (session.workspaceId) {
    headers["workspace-id"] = session.workspaceId;
  }
  return headers;
}
