/**
 * Plaud session helpers for the in-browser API client.
 *
 * The Chrome extension reuses the user's open Plaud Web tab: tokens,
 * workspace ID, and the API region live in Plaud Web storage. This module
 * isolates the storage + JWT plumbing so `audioExport.js` doesn't have to
 * inline ~150 lines of session glue.
 *
 * Pure helpers; only side effect is reading page `localStorage` /
 * `sessionStorage`.
 */

const PLAUD_API_FALLBACK = "https://api.plaud.ai";
const KNOWN_USER_TOKEN_KEYS = ["pld_tokenstr", "tokenstr"];
const AUTHISH_KEY_RE = /token|jwt|auth|session/i;
const WORKSPACE_LIST_KEY_RE = /workspaceList/i;
const CURRENT_WORKSPACE_KEY_RE = /currentWorkspaceId/i;
const API_DOMAIN_KEY_RE = /plaud_user_api_domain/i;
const RELEVANT_STORAGE_KEY_RE =
  /^(pld_|tokenstr$|plaud_)|token|jwt|auth|workspace|api_domain/i;
const JWT_RE =
  /\b(?:Bearer\s+)?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+)\b/;

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

/** @type {null | { localStorage?: Record<string, string>, sessionStorage?: Record<string, string> }} */
let pageStorageSnapshot = null;

function readStorageArea(storageName) {
  try {
    const storage = globalThis[storageName];
    if (!storage) return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) out[key] = storage.getItem(key) || "";
    }
    return out;
  } catch {
    return {};
  }
}

function currentStorageSnapshot() {
  return {
    localStorage: {
      ...readStorageArea("localStorage"),
      ...(pageStorageSnapshot?.localStorage || {}),
    },
    sessionStorage: {
      ...readStorageArea("sessionStorage"),
      ...(pageStorageSnapshot?.sessionStorage || {}),
    },
  };
}

function rawScopedStorageValue(key) {
  const snapshot = currentStorageSnapshot();
  if (Object.prototype.hasOwnProperty.call(snapshot.localStorage, key)) {
    return snapshot.localStorage[key];
  }
  if (Object.prototype.hasOwnProperty.call(snapshot.sessionStorage, key)) {
    return snapshot.sessionStorage[key];
  }
  return null;
}

/** @param {string} key */
export function getScopedStorageValue(key) {
  return parseStoredValue(rawScopedStorageValue(key));
}

function listStorageKeys() {
  const snapshot = currentStorageSnapshot();
  return [
    ...Object.keys(snapshot.localStorage).map((key) => ({
      area: "localStorage",
      key,
    })),
    ...Object.keys(snapshot.sessionStorage).map((key) => ({
      area: "sessionStorage",
      key,
    })),
  ];
}

function maskStorageKey(key, userId = "") {
  let out = String(key || "");
  if (userId) {
    out = out.replaceAll(userId, "<user>");
  }
  return out.replace(/pld_[^:_]+(?=[:_])/g, "pld_<user>");
}

function storageEntries() {
  const snapshot = currentStorageSnapshot();
  return [
    ...Object.entries(snapshot.localStorage).map(([key, raw]) => ({
      area: "localStorage",
      key,
      raw,
      value: parseStoredValue(raw),
    })),
    ...Object.entries(snapshot.sessionStorage).map(([key, raw]) => ({
      area: "sessionStorage",
      key,
      raw,
      value: parseStoredValue(raw),
    })),
  ];
}

function normalizeJwtCandidate(value) {
  if (typeof value !== "string") return "";
  const direct = value.replace(/^Bearer\s+/i, "").trim();
  if (decodeJwtSubject(direct)) return direct;
  const match = value.match(JWT_RE);
  if (match?.[1] && decodeJwtSubject(match[1])) return match[1];
  return "";
}

function extractJwtFromValue(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    const direct = normalizeJwtCandidate(value);
    if (direct) return direct;
    const parsed = parseStoredValue(value);
    if (parsed !== value) return extractJwtFromValue(parsed, depth + 1, seen);
    return "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const prioritized = entries.sort(([a], [b]) => {
    const aw = AUTHISH_KEY_RE.test(a) ? 0 : 1;
    const bw = AUTHISH_KEY_RE.test(b) ? 0 : 1;
    return aw - bw;
  });
  for (const [, child] of prioritized) {
    const token = extractJwtFromValue(child, depth + 1, seen);
    if (token) return token;
  }
  return "";
}

function findUserTokenCandidate() {
  for (const key of KNOWN_USER_TOKEN_KEYS) {
    const raw = rawScopedStorageValue(key);
    if (raw) {
      return {
        token: String(parseStoredValue(raw) || ""),
        source: key,
        exact: true,
      };
    }
  }

  for (const entry of storageEntries()) {
    if (
      !AUTHISH_KEY_RE.test(entry.key) &&
      !RELEVANT_STORAGE_KEY_RE.test(entry.key)
    ) {
      continue;
    }
    const token = extractJwtFromValue(entry.value || entry.raw);
    if (token) {
      return {
        token,
        source: `${entry.area}:${maskStorageKey(entry.key)}`,
        exact: false,
      };
    }
  }
  return { token: "", source: "", exact: false };
}

function extractWorkspaceListFromValue(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    const parsed = parseStoredValue(value);
    return parsed === value
      ? null
      : extractWorkspaceListFromValue(parsed, depth + 1, seen);
  }
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (
    Array.isArray(value) &&
    value.some((item) => item?.workspaceId || item?.workspaceToken)
  ) {
    return value;
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    if (!WORKSPACE_LIST_KEY_RE.test(key) && typeof child !== "object") continue;
    const found = extractWorkspaceListFromValue(child, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function findWorkspaceList(userId) {
  const exact = userId
    ? getScopedStorageValue(`pld_${userId}:workspaceList`)
    : null;
  if (Array.isArray(exact)) return exact;

  for (const entry of storageEntries()) {
    if (
      !WORKSPACE_LIST_KEY_RE.test(entry.key) &&
      !RELEVANT_STORAGE_KEY_RE.test(entry.key)
    ) {
      continue;
    }
    const found = extractWorkspaceListFromValue(entry.value || entry.raw);
    if (found) return found;
  }
  return null;
}

function findWorkspaceId(userId, workspaceList) {
  const exact = userId
    ? getScopedStorageValue(`pld_${userId}:currentWorkspaceId`)
    : null;
  if (exact != null && String(exact).trim()) return String(exact).trim();

  for (const entry of storageEntries()) {
    if (!CURRENT_WORKSPACE_KEY_RE.test(entry.key)) continue;
    const value = parseStoredValue(entry.raw);
    if (value != null && String(value).trim()) return String(value).trim();
  }

  if (Array.isArray(workspaceList) && workspaceList.length === 1) {
    const onlyWorkspaceId = workspaceList[0]?.workspaceId;
    if (onlyWorkspaceId != null && String(onlyWorkspaceId).trim()) {
      return String(onlyWorkspaceId).trim();
    }
  }
  return "";
}

function findApiDomainValue(userId) {
  const exact =
    (userId && getScopedStorageValue(`pld_${userId}:plaud_user_api_domain`)) ||
    getScopedStorageValue("plaud_user_api_domain");
  if (exact) return exact;

  for (const entry of storageEntries()) {
    if (API_DOMAIN_KEY_RE.test(entry.key) && entry.value) return entry.value;
  }
  return "";
}

async function readPageStorageSnapshot(timeoutMs = 1200) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const id = `plaud-exporter-session-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => finish(null), timeoutMs);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      resolve(value);
    }

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (
        !data ||
        data.source !== "plaud-exporter-page-session" ||
        data.id !== id
      ) {
        return;
      }
      finish(data.snapshot || null);
    }

    window.addEventListener("message", onMessage);

    const script = document.createElement("script");
    script.textContent = `(() => {
      const id = ${JSON.stringify(id)};
      function dump(name) {
        try {
          const storage = window[name];
          const out = {};
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key) out[key] = storage.getItem(key) || "";
          }
          return out;
        } catch (_) {
          return {};
        }
      }
      window.postMessage({
        source: "plaud-exporter-page-session",
        id,
        snapshot: {
          localStorage: dump("localStorage"),
          sessionStorage: dump("sessionStorage"),
        },
      }, "*");
    })();`;
    (document.documentElement || document.head || document.body).appendChild(
      script
    );
    script.remove();
  });
}

async function ensurePageStorageSnapshot() {
  const snapshot = await readPageStorageSnapshot();
  if (!snapshot) return false;
  pageStorageSnapshot = snapshot;
  return true;
}

/**
 * Session diagnostics for logs. Never includes token values.
 */
export function describePlaudSessionStorage() {
  let userTokenCandidate = { token: "", source: "", exact: false };
  let userId = "";
  let workspaceId = null;
  let workspaceList = null;
  let currentWorkspace = null;
  let hasUserScopedApiDomain = false;
  let hasGlobalApiDomain = false;
  try {
    userTokenCandidate = findUserTokenCandidate();
    userId = decodeJwtSubject(userTokenCandidate.token);
    workspaceList = findWorkspaceList(userId);
    workspaceId = findWorkspaceId(userId, workspaceList);
    currentWorkspace = Array.isArray(workspaceList)
      ? workspaceList.find(
          (workspace) => workspace?.workspaceId === workspaceId
        )
      : null;
    hasUserScopedApiDomain = !!(
      userId && getScopedStorageValue(`pld_${userId}:plaud_user_api_domain`)
    );
    hasGlobalApiDomain = !!getScopedStorageValue("plaud_user_api_domain");
  } catch {
    // Best-effort diagnostics only.
  }

  const keys = listStorageKeys();
  const relevantKeys = keys
    .filter(({ key }) => RELEVANT_STORAGE_KEY_RE.test(key))
    .map(({ area, key }) => `${area}:${maskStorageKey(key, userId)}`)
    .slice(0, 80);
  const workspaceExpiresAt = currentWorkspace?.expiresAt ?? null;
  const workspaceExpiresMs =
    workspaceExpiresAt == null || workspaceExpiresAt === ""
      ? null
      : Number(workspaceExpiresAt) < 1e12
        ? Number(workspaceExpiresAt) * 1000
        : Number(workspaceExpiresAt);

  return {
    origin:
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "",
    localStorageKeyCount: keys.length,
    relevantKeys,
    hasKnownUserToken: userTokenCandidate.exact,
    hasDiscoveredJwt: !!userTokenCandidate.token,
    userTokenSource: userTokenCandidate.source,
    decodedUserId: !!userId,
    userIdPrefix: userId ? `${userId.slice(0, 4)}…` : "",
    hasCurrentWorkspaceId:
      workspaceId != null && String(workspaceId).trim() !== "",
    workspaceListType: Array.isArray(workspaceList)
      ? "array"
      : workspaceList == null
        ? "missing"
        : typeof workspaceList,
    workspaceListLength: Array.isArray(workspaceList)
      ? workspaceList.length
      : null,
    currentWorkspaceFound: !!currentWorkspace,
    hasWorkspaceToken: !!currentWorkspace?.workspaceToken,
    workspaceTokenExpired:
      workspaceExpiresMs == null ? null : workspaceExpiresMs <= Date.now(),
    hasUserScopedApiDomain,
    hasGlobalApiDomain,
  };
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
  return normalizeApiBase(findApiDomainValue(userId) || PLAUD_API_FALLBACK);
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

/**
 * Reads the active Plaud session from page storage. Throws when no auth token
 * is present (user logged out / wrong tab).
 *
 * @returns {Promise<PlaudBrowserSession>}
 */
export async function getPlaudSession() {
  let userTokenCandidate = findUserTokenCandidate();
  if (!userTokenCandidate.token) {
    await ensurePageStorageSnapshot();
    userTokenCandidate = findUserTokenCandidate();
  }

  const userToken = userTokenCandidate.token;
  const userId = decodeJwtSubject(userToken);
  const workspaceList = findWorkspaceList(userId);
  const workspaceId = findWorkspaceId(userId, workspaceList);
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
      "Не удалось прочитать токен авторизации Plaud из storage страницы. Откройте Plaud Web, дождитесь списка записей и попробуйте снова."
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
    tokenSource: userTokenCandidate.source,
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
