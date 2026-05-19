/**
 * Best-effort secret redaction for logs, errors, and crash reports.
 *
 * Used everywhere we surface text to stdout/stderr or write diagnostic files.
 * The goal is not to make secrets unrecoverable from a hostile observer (that
 * is impossible for transparent logs), but to make it very hard to leak them
 * by accident: pasting an error message, sending a diagnostic file, copying a
 * fetch error into an issue.
 */

const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-=+/]+/gi;
const COOKIE_HEADER_RE = /\b(Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi;
const AUTH_HEADER_RE = /\b(Authorization|authorization)\s*:\s*[^\r\n]+/g;
const PLAUD_STORAGE_KEY_RE =
  /\b(pld_[A-Za-z0-9_:.-]*|pld_tokenstr|tokenstr|workspaceToken|workspaceList)\b\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s,;}\]]+)/gi;
const HEX_TOKEN_RE = /\b[A-Fa-f0-9]{64,}\b/g;
/**
 * Telegram bot tokens look like `<bot-id>:<url-safe-secret>` (e.g. `123456789:AA…`).
 * The numeric prefix is the bot user id (5–11 digits in practice) followed by
 * a colon and a 30+ char URL-safe secret.
 */
const TELEGRAM_BOT_TOKEN_RE = /\b\d{5,12}:[A-Za-z0-9_-]{20,}\b/g;
/**
 * api.telegram.org URLs embed the bot token in the path (`/bot<token>/method`).
 * We strip it eagerly so any stray request log can't leak the token.
 */
const TELEGRAM_BOT_URL_RE =
  /(api\.telegram\.org\/bot)\d{5,12}:[A-Za-z0-9_-]{20,}/g;

const SENSITIVE_KEY_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "workspace-id",
  "workspacetoken",
  "workspace_token",
  "pld_tokenstr",
  "tokenstr",
  "token",
  "access_token",
  "refresh_token",
  "jwt",
  "api_key",
  "apikey",
  "password",
  "secret",
]);

/**
 * @param {string} value
 * @returns {string}
 */
export function redactString(value) {
  if (typeof value !== "string" || !value) return value;
  return value
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(AUTH_HEADER_RE, "$1: [REDACTED]")
    .replace(COOKIE_HEADER_RE, "$1: [REDACTED]")
    .replace(PLAUD_STORAGE_KEY_RE, "$1: [REDACTED]")
    .replace(TELEGRAM_BOT_URL_RE, "$1[REDACTED_TELEGRAM_TOKEN]")
    .replace(TELEGRAM_BOT_TOKEN_RE, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(HEX_TOKEN_RE, "[REDACTED_HEX]");
}

/**
 * Recursively redacts object/array values. Sensitive keys are replaced with
 * the string "[REDACTED]" regardless of the value.
 *
 * @param {unknown} value
 * @param {{ depth?: number; maxDepth?: number }} [options]
 * @returns {unknown}
 */
export function redactValue(value, options = {}) {
  const depth = options.depth || 0;
  const maxDepth = options.maxDepth ?? 8;
  if (value == null) return value;
  if (depth >= maxDepth) return "[REDACTED_DEEP]";

  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactValue(item, { depth: depth + 1, maxDepth })
    );
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_NAMES.has(String(key).toLowerCase())) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactValue(val, { depth: depth + 1, maxDepth });
  }
  return out;
}

/**
 * Returns a redacted Error-like object safe for logging.
 *
 * @param {unknown} err
 * @returns {{ name: string; message: string; stack?: string }}
 */
export function redactError(err) {
  if (!err) return { name: "Error", message: "" };
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactString(err.message || ""),
      stack: err.stack ? redactString(err.stack) : undefined,
    };
  }
  return { name: "Error", message: redactString(String(err)) };
}
