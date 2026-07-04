/**
 * Shared emoji tokens and human-readable labels for Telegram bot copy.
 */

export const EMOJI_BRAND = "🛰";
export const EMOJI_SYNC = "🔄";
export const EMOJI_SUCCESS = "✅";
export const EMOJI_SCHEDULE = "🕒";
export const EMOJI_PROGRESS = "⏳";
export const EMOJI_FILES = "📁";
export const EMOJI_TREE = "🌳";
export const EMOJI_WARNING = "⚠️";
export const EMOJI_STATS = "📊";
export const EMOJI_SETTINGS = "⚙️";

/** @type {Record<number, string>} */
export const INTERVAL_HUMAN_LABELS = {
  60: "Каждый час",
  120: "Каждые 2 ч",
  240: "Каждые 4 ч",
  480: "Каждые 8 ч",
};

/**
 * @param {number} min
 * @returns {string}
 */
export function humanIntervalLabel(min) {
  return INTERVAL_HUMAN_LABELS[min] ?? `${min} мин`;
}

/**
 * Short local timestamp for menu one-liners: `04.07 18:30`.
 *
 * @param {string | null | undefined} isoString
 * @returns {string}
 */
export function formatShortDateTimeLocal(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
