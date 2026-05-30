/**
 * Shared HTML/text formatters for Telegram bot copy.
 */

const TELEGRAM_HTML_MAX_LEN = 3800;

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

export function truncateTelegramHtml(html) {
  const text = String(html || "");
  if (text.length <= TELEGRAM_HTML_MAX_LEN) return text;
  return `${text.slice(0, TELEGRAM_HTML_MAX_LEN - 1)}…`;
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
