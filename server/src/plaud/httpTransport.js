/**
 * HTTP transport for the internal Plaud API.
 *
 * Concerns kept here only:
 *  - Building Cloudflare-friendly headers (Origin/Referer/User-Agent).
 *  - Per-request timeout (`config.apiTimeoutMs`).
 *  - Region redirect via Plaud's `-302` envelope (rewrites `session.apiBase`).
 *  - Retry policy for transient failures; never retries 401/403.
 *
 * Higher-level endpoint helpers (recordings, summaries, audio URLs) live in
 * sibling modules and import only `fetchPlaudApi` / `fetchUrlTextWithRetries`.
 */
import { config } from "../config/config.js";
import { PlaudAuthError } from "./errors.js";

const PLAUD_API_FALLBACK = "https://api.plaud.ai";

function buildPlaudHeaders(session, extra = {}) {
  const webOrigin = config.plaudWebOrigin;
  const headers = {
    Authorization: session.authHeader,
    "edit-from": "web",
    "app-platform": "web",
    "Content-Type": "application/json",
    // Plaud's API sits behind Cloudflare; bare Node fetch gets HTML 403 without
    // browser-like Origin/Referer/User-Agent (misread as "session expired").
    Origin: webOrigin,
    Referer: `${webOrigin}/`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...extra,
  };
  if (session.workspaceId) headers["workspace-id"] = session.workspaceId;
  return headers;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
}

function normalizeApiBase(rawBase) {
  const parsed = typeof rawBase === "object" && rawBase ? rawBase.domain : rawBase;
  if (!parsed || typeof parsed !== "string") return PLAUD_API_FALLBACK;
  try {
    const withProtocol = parsed.startsWith("http") ? parsed : `https://${parsed}`;
    const url = new URL(withProtocol);
    if (!url.hostname.endsWith(".plaud.ai")) return PLAUD_API_FALLBACK;
    return url.origin;
  } catch {
    return PLAUD_API_FALLBACK;
  }
}

async function fetchPlaudApiOnce(session, path, options = {}) {
  const { retryDomainSwitch = true, headers = {}, method = "GET" } = options;
  const url = new URL(path, session.apiBase);
  let response;
  try {
    response = await fetchWithTimeout(
      url.toString(),
      { method, headers: buildPlaudHeaders(session, headers) },
      config.apiTimeoutMs
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Plaud API timeout (${config.apiTimeoutMs} ms)`);
    }
    throw error;
  }

  const payload = await response.json().catch(() => null);

  if (retryDomainSwitch && payload?.status === -302 && payload?.data?.domains?.api) {
    session.apiBase = normalizeApiBase(payload.data.domains.api);
    return fetchPlaudApiOnce(session, path, { ...options, retryDomainSwitch: false });
  }

  if (response.status === 401 || response.status === 403) {
    throw new PlaudAuthError(
      `Plaud API auth failed (HTTP ${response.status}); session likely expired.`,
      response.status
    );
  }

  if (!response.ok) {
    throw new Error(`Plaud API HTTP ${response.status}`);
  }

  if (typeof payload?.status === "number" && payload.status < 0) {
    throw new Error(payload?.message || `Plaud API returned status ${payload.status}`);
  }

  return payload;
}

function shouldRetryFetchAttempt(error) {
  if (error instanceof PlaudAuthError) return false;
  const msg = String(error?.message || error || "");
  if (/\bHTTP\s+401\b/.test(msg) || /\bHTTP\s+403\b/.test(msg)) return false;
  if (error?.name === "AbortError") return true;
  if (/Plaud API timeout/i.test(msg)) return true;
  if (/\bHTTP\s+(429|502|503|504)\b/.test(msg)) return true;
  if (
    /Failed to fetch/i.test(msg) ||
    /NetworkError/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)
  ) {
    return true;
  }
  return false;
}

/**
 * Perform a Plaud API call with retries and region-switch handling.
 *
 * @param {object} session
 * @param {string} path Absolute URL or path relative to `session.apiBase`.
 * @param {{ method?: string; headers?: Record<string, string> }} [options]
 */
export async function fetchPlaudApi(session, path, options = {}) {
  let lastError;
  const max = config.apiMaxRetries;
  for (let attempt = 0; attempt < max; attempt++) {
    if (attempt > 0) await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    try {
      return await fetchPlaudApiOnce(session, path, options);
    } catch (error) {
      lastError = error;
      if (!shouldRetryFetchAttempt(error) || attempt >= max - 1) throw error;
    }
  }
  throw lastError;
}

/**
 * Fetch a plain-text resource (typically a presigned summary blob) with the
 * same retry policy as the API client but without Plaud headers/auth.
 */
export async function fetchUrlTextWithRetries(url) {
  let lastError;
  const max = config.apiMaxRetries;
  for (let attempt = 0; attempt < max; attempt++) {
    if (attempt > 0) await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    try {
      const response = await fetchWithTimeout(url, {}, config.apiTimeoutMs);
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status} when fetching summary body`);
        if (![429, 502, 503, 504].includes(response.status) || attempt >= max - 1) {
          throw err;
        }
        lastError = err;
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (!shouldRetryFetchAttempt(error) || attempt >= max - 1) throw error;
    }
  }
  throw lastError;
}
