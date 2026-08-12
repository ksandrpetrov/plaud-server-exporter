/**
 * Mirrors `getPlaudSession()` from the extension's
 * `features/audioExport/audioExport.js`, but reads from a serialized
 * snapshot instead of a live `localStorage`. Returns an object with the same
 * shape consumed by the API client.
 */

const PLAUD_API_FALLBACK = "https://api.plaud.ai";

function parseStoredValue(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeBearerToken(token) {
  if (!token) return "";
  const parsedToken = parseStoredValue(token);
  const tokenString = String(parsedToken || "").trim();
  if (!tokenString) return "";
  return tokenString.toLowerCase().startsWith("bearer ")
    ? tokenString
    : `Bearer ${tokenString}`;
}

function decodeJwtSubject(token) {
  try {
    const tokenString = String(parseStoredValue(token) || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const parts = tokenString.split(".");
    if (parts.length !== 3) return "";
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return decoded?.sub || "";
  } catch {
    return "";
  }
}

function normalizeApiBase(rawBase) {
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

function scopedValue(snapshot, key) {
  const ls = snapshot?.localStorage || {};
  return parseStoredValue(ls[key]);
}

function apiBaseFromSnapshot(snapshot, userId) {
  const userScoped = userId
    ? scopedValue(snapshot, `pld_${userId}:plaud_user_api_domain`)
    : null;
  const global = scopedValue(snapshot, "plaud_user_api_domain");
  return normalizeApiBase(
    userScoped || global || snapshot?.apiBase || PLAUD_API_FALLBACK
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
 *   userId: string;
 *   authMode?: "oauth" | "snapshot";
 *   apiMode?: "official" | "web";
 * }} PlaudSession
 */

/**
 * @param {import("./sessionStore.js").SessionSnapshot} snapshot
 * @returns {PlaudSession}
 */
export function createSessionFromSnapshot(snapshot) {
  if (!snapshot || !snapshot.localStorage) {
    throw new Error("Plaud session snapshot is missing or malformed.");
  }

  const userToken =
    scopedValue(snapshot, "pld_tokenstr") || scopedValue(snapshot, "tokenstr");
  if (!userToken) {
    throw new Error(
      "Plaud user token is missing (pld_tokenstr/tokenstr). Re-run server:auth."
    );
  }

  const userId = decodeJwtSubject(userToken);
  const workspaceId = userId
    ? scopedValue(snapshot, `pld_${userId}:currentWorkspaceId`)
    : null;
  const workspaceList = userId
    ? scopedValue(snapshot, `pld_${userId}:workspaceList`)
    : null;

  const currentWorkspace = Array.isArray(workspaceList)
    ? workspaceList.find((ws) => ws?.workspaceId === workspaceId)
    : null;

  let workspaceTokenRaw = "";
  if (currentWorkspace?.workspaceToken) {
    const exp = currentWorkspace.expiresAt;
    if (exp == null || exp === "") {
      workspaceTokenRaw = currentWorkspace.workspaceToken;
    } else {
      let n = Number(exp);
      if (Number.isFinite(n)) {
        if (n < 1e12) n *= 1000;
        if (n > Date.now()) workspaceTokenRaw = currentWorkspace.workspaceToken;
      }
    }
  }

  const userAuthHeader = normalizeBearerToken(userToken);
  const workspaceAuthHeader = normalizeBearerToken(workspaceTokenRaw);
  const authHeader = workspaceAuthHeader || userAuthHeader;

  if (!authHeader) {
    throw new Error(
      "Could not build an Authorization header from the Plaud snapshot."
    );
  }

  const sortBy =
    userId && workspaceId
      ? scopedValue(snapshot, `pld_${userId}_${workspaceId}:sort_by`)
      : null;

  return {
    apiBase: apiBaseFromSnapshot(snapshot, userId),
    authHeader,
    userAuthHeader,
    workspaceAuthHeader,
    workspaceId:
      workspaceId != null && String(workspaceId).trim()
        ? String(workspaceId).trim()
        : "",
    sortBy: typeof sortBy === "string" && sortBy.trim() ? sortBy : "start_time",
    userId,
    authMode: "snapshot",
    apiMode: "web",
  };
}

/**
 * True when Plaud Web has written both the user JWT and workspace session keys.
 * The API typically rejects requests that only carry the user token (HTTP 403).
 *
 * @param {Record<string, string>} keys
 */
export function isLocalStorageSessionReady(keys) {
  const userToken = keys?.["pld_tokenstr"] || keys?.["tokenstr"];
  if (!userToken) return { ready: false, missing: ["pld_tokenstr"] };
  const userId = decodeJwtSubject(userToken);
  if (!userId) {
    return { ready: false, missing: ["jwt_sub"] };
  }
  const missing = [];
  if (!keys[`pld_${userId}:currentWorkspaceId`]) {
    missing.push(`pld_${userId}:currentWorkspaceId`);
  }
  if (!keys[`pld_${userId}:workspaceList`]) {
    missing.push(`pld_${userId}:workspaceList`);
  }
  return { ready: missing.length === 0, missing };
}

/**
 * @param {import("./sessionStore.js").SessionSnapshot} snapshot
 */
export function assertSnapshotReadyForApi(snapshot) {
  const check = isLocalStorageSessionReady(snapshot?.localStorage || {});
  if (check.ready) return;
  throw new Error(
    "Plaud session snapshot is incomplete (workspace keys missing). " +
      "In the browser, wait until your recordings list is visible, then run " +
      "`npm run server:auth` again. Missing keys: " +
      check.missing.join(", ")
  );
}

/**
 * Sanity describes what is missing without revealing values.
 *
 * @param {import("./sessionStore.js").SessionSnapshot | null} snapshot
 */
export function describeSnapshot(snapshot) {
  if (!snapshot) return { present: false };
  const ls = snapshot.localStorage || {};
  const userToken = ls["pld_tokenstr"] || ls["tokenstr"];
  const userId = userToken ? decodeJwtSubject(userToken) : "";
  return {
    present: true,
    savedAt: snapshot.savedAt || null,
    apiBase: apiBaseFromSnapshot(snapshot, userId),
    hasUserToken: !!userToken,
    userIdPrefix: userId ? `${userId.slice(0, 4)}…` : null,
    hasWorkspaceId: !!(userId && ls[`pld_${userId}:currentWorkspaceId`]),
    hasWorkspaceList: !!(userId && ls[`pld_${userId}:workspaceList`]),
    cookieCount: Array.isArray(snapshot.cookies) ? snapshot.cookies.length : 0,
  };
}
