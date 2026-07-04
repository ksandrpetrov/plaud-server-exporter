/**
 * Plaud session helpers for the in-browser API client.
 *
 * The Chrome extension reuses the user's open Plaud Web tab: tokens,
 * workspace ID, and the API region all live in `localStorage`. This module
 * isolates the storage + JWT plumbing so `audioExport.js` doesn't have to
 * inline ~150 lines of session glue.
 *
 * Pure helpers; only side effect is reading `localStorage`.
 */

const PLAUD_API_FALLBACK = "https://api.plaud.ai";

/** @param {string | null | undefined} value */
export function parseStoredValue(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** @param {string | null | undefined} token */
export function normalizeBearerToken(token) {
  if (!token) return "";
  const parsedToken = parseStoredValue(token);
  const tokenString = String(parsedToken || "").trim();
  if (!tokenString) return "";
  return tokenString.toLowerCase().startsWith("bearer ")
    ? tokenString
    : `Bearer ${tokenString}`;
}

/** @param {string | null | undefined} token */
export function decodeJwtSubject(token) {
  try {
    const tokenString = String(parseStoredValue(token) || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const parts = tokenString.split(".");
    if (parts.length !== 3) return "";
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = normalizedPayload.padEnd(
      Math.ceil(normalizedPayload.length / 4) * 4,
      "="
    );
    const decoded = JSON.parse(atob(payload));
    return decoded.sub || "";
  } catch {
    return "";
  }
}

/** @param {string} key */
export function getScopedStorageValue(key) {
  return parseStoredValue(localStorage.getItem(key));
}

/**
 * Resolves the regional API origin. Plaud serves traffic from multiple regions
 * and the active one is stored per-user in `localStorage`.
 *
 * @param {string | { domain?: string } | null | undefined} rawBase
 * @returns {string}
 */
export function normalizeApiBase(rawBase) {
  const parsedBase =
    typeof rawBase === "object" && rawBase ? rawBase.domain : rawBase;
  if (!parsedBase || typeof parsedBase !== "string") return PLAUD_API_FALLBACK;

  try {
    const withProtocol = parsedBase.startsWith("http")
      ? parsedBase
      : `https://${parsedBase}`;
    const url = new URL(withProtocol);
    if (!url.hostname.endsWith(".plaud.ai")) return PLAUD_API_FALLBACK;
    return url.origin;
  } catch {
    return PLAUD_API_FALLBACK;
  }
}

/** @param {string} [userId] */
export function getPlaudApiBase(userId) {
  const userScopedBase = userId
    ? getScopedStorageValue(`pld_${userId}:plaud_user_api_domain`)
    : null;
  const globalBase = getScopedStorageValue("plaud_user_api_domain");
  return normalizeApiBase(userScopedBase || globalBase || PLAUD_API_FALLBACK);
}

/**
 * @typedef {{
 *   apiBase: string;
 *   authHeader: string;
 *   userAuthHeader: string;
 *   workspaceAuthHeader: string;
 *   workspaceId: string;
 *   sortBy: string;
 * }} PlaudBrowserSession
 */

/**
 * Reads the active Plaud session from the page's `localStorage`. Throws when
 * no auth token is present (user logged out / wrong tab).
 *
 * @returns {PlaudBrowserSession}
 */
export function getPlaudSession() {
  const userToken =
    getScopedStorageValue("pld_tokenstr") || getScopedStorageValue("tokenstr");
  const userId = decodeJwtSubject(userToken);
  const workspaceId = userId
    ? getScopedStorageValue(`pld_${userId}:currentWorkspaceId`)
    : null;
  const workspaceList = userId
    ? getScopedStorageValue(`pld_${userId}:workspaceList`)
    : null;
  const currentWorkspace = Array.isArray(workspaceList)
    ? workspaceList.find((workspace) => workspace.workspaceId === workspaceId)
    : null;
  const nowMs = Date.now();
  const ws = currentWorkspace;
  /** Workspace JWT: как в UI, если нет expiresAt — доверяем токену; иначе проверяем срок (секунды или мс). */
  let workspaceTokenRaw = "";
  if (ws?.workspaceToken) {
    const exp = ws.expiresAt;
    if (exp == null || exp === "") {
      workspaceTokenRaw = ws.workspaceToken;
    } else {
      let n = Number(exp);
      if (Number.isFinite(n)) {
        if (n < 1e12) n *= 1000;
        if (n > nowMs) workspaceTokenRaw = ws.workspaceToken;
      }
    }
  }
  const userAuthHeader = normalizeBearerToken(userToken);
  const workspaceAuthHeader = normalizeBearerToken(workspaceTokenRaw);
  const authHeader = workspaceAuthHeader || userAuthHeader;

  if (!authHeader) {
    throw new Error(
      "Не удалось прочитать токен авторизации Plaud. Войдите в аккаунт."
    );
  }

  const sortBy =
    userId && workspaceId
      ? getScopedStorageValue(`pld_${userId}_${workspaceId}:sort_by`)
      : null;

  return {
    apiBase: getPlaudApiBase(userId),
    authHeader,
    userAuthHeader,
    workspaceAuthHeader,
    workspaceId:
      workspaceId != null && String(workspaceId).trim()
        ? String(workspaceId).trim()
        : "",
    sortBy: typeof sortBy === "string" && sortBy.trim() ? sortBy : "start_time",
  };
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
