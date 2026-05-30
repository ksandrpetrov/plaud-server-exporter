/**
 * Shared HTML/text formatters for Telegram bot copy.
 */

/** Conservative cap under Telegram's 4096 HTML limit (margin for entities). */
export const TELEGRAM_HTML_MAX_LEN = 3800;

const HTML_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?>/g;

export function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function describeStatusVerdict(rawStatus) {
  switch (String(rawStatus || "")) {
    case "completed":
      return "ok";
    case "completed_with_errors":
      return "с ошибками";
    case "plaud_changed":
      return "Plaud поменял API";
    case "failed":
      return "упал";
    case "running":
      return "идёт сейчас";
    default:
      return String(rawStatus || "неизвестно");
  }
}

export function formatDateTimeLocal(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function isSelfClosingTag(tag) {
  return tag === "br" || tag === "hr" || tag === "img";
}

function closeOpenHtmlTags(html) {
  const stack = [];
  HTML_TAG_RE.lastIndex = 0;
  let match;
  while ((match = HTML_TAG_RE.exec(html))) {
    const closing = match[1];
    const tag = match[2].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === tag) {
          stack.splice(i, 1);
          break;
        }
      }
    } else if (!isSelfClosingTag(tag)) {
      stack.push(tag);
    }
  }
  if (!stack.length) return html;
  let trailer = "";
  for (let i = stack.length - 1; i >= 0; i--) {
    trailer += `</${stack[i]}>`;
  }
  return html + trailer;
}

/**
 * Returns an HTML-safe prefix of `text` of length ≤ `length`, never cutting
 * inside a tag or entity. Adds closing tags for anything still open.
 */
export function safeSliceHtml(text, length) {
  if (length >= text.length) return text;
  if (length <= 0) return "";
  let cut = length;
  const lastLt = text.lastIndexOf("<", cut - 1);
  const lastGt = text.lastIndexOf(">", cut - 1);
  if (lastLt > lastGt) cut = lastLt;
  const lastAmp = text.lastIndexOf("&", cut - 1);
  const lastSemi = text.lastIndexOf(";", cut - 1);
  if (lastAmp > lastSemi && cut - lastAmp <= 10) cut = lastAmp;
  if (cut <= 0) return "";
  return closeOpenHtmlTags(text.slice(0, cut));
}

/**
 * Tag-aware clip for Telegram HTML messages (static copy and streaming).
 */
export function clipTelegramText(text) {
  const s = String(text ?? "");
  if (s.length <= TELEGRAM_HTML_MAX_LEN) return s;
  let cut = TELEGRAM_HTML_MAX_LEN - 1;
  for (let i = 0; i < 8; i++) {
    const candidate = safeSliceHtml(s, cut) + "…";
    if (candidate.length <= TELEGRAM_HTML_MAX_LEN) return candidate;
    cut = Math.max(0, cut - (candidate.length - TELEGRAM_HTML_MAX_LEN) - 4);
  }
  return s.slice(0, TELEGRAM_HTML_MAX_LEN);
}

/** @deprecated Use clipTelegramText */
export function truncateTelegramHtml(html) {
  return clipTelegramText(html);
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function describeRecordStatus(rawStatus) {
  switch (String(rawStatus || "")) {
    case "success":
      return "ok";
    case "updated":
      return "обновлён";
    case "already_synced":
      return "без изменений";
    case "skipped":
      return "пропущен";
    case "error":
      return "ошибка";
    case "loading":
      return "загрузка";
    case "idle":
      return "ожидание";
    case "not_synced":
      return "не синхр.";
    default:
      return describeStatusVerdict(rawStatus);
  }
}
