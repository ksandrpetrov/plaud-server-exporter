import { escapeHtml, formatDateTimeLocal } from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";

export const SETTINGS_CLOSED_TEXT = "⚙️ Настройки закрыты.";

/**
 * @param {{
 *   intervalMin: number,
 *   lastSyncAt: string | null,
 *   nowMs?: number,
 *   scheduledSummaryVisible?: boolean,
 * }} params
 */
export function settingsScreenHtml({
  intervalMin,
  lastSyncAt,
  nowMs,
  scheduledSummaryVisible = false,
}) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  let nextLine = "🕘 Следующий автозапуск: после ближайшей проверки.";
  if (lastSyncAt) {
    const last = Date.parse(lastSyncAt);
    if (Number.isFinite(last)) {
      const dueAt = last + intervalMin * 60_000;
      if (dueAt <= now) {
        nextLine = "🕘 Следующий автозапуск: сейчас (на ближайшем тике).";
      } else {
        nextLine = `🕘 Следующий автозапуск: ${escapeHtml(formatDateTimeLocal(new Date(dueAt).toISOString()))}.`;
      }
    }
  }
  const summaryLine = scheduledSummaryVisible
    ? "🔔 Сообщения автосинка: <b>вкл</b> — пришлю сводку в чат."
    : "🔕 Сообщения автосинка: <b>выкл</b> — автосинк работает тихо.";
  return [
    "⚙️ <b>Настройки расписания</b>",
    `🕒 Интервал автозапуска: ${intervalMin} мин`,
    nextLine,
    summaryLine,
    "",
    "Выбери интервал или переключи уведомления:",
  ].join("\n");
}

/**
 * @param {{
 *   intervalMin: number,
 *   lastSyncAt: string | null,
 *   nowMs?: number,
 *   scheduledSummaryVisible?: boolean,
 * }} params
 * @returns {string}
 */
export function settingsScreenRichMarkdown({
  intervalMin,
  lastSyncAt,
  nowMs,
  scheduledSummaryVisible = false,
}) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  let nextLine = "После ближайшей проверки.";
  if (lastSyncAt) {
    const last = Date.parse(lastSyncAt);
    if (Number.isFinite(last)) {
      const dueAt = last + intervalMin * 60_000;
      if (dueAt <= now) {
        nextLine = "Сейчас (на ближайшем тике).";
      } else {
        nextLine = formatDateTimeLocal(new Date(dueAt).toISOString());
      }
    }
  }
  const summaryLine = scheduledSummaryVisible
    ? "🔔 **вкл** — пришлю сводку в чат"
    : "🔕 **выкл** — автосинк работает тихо";
  const md = [
    "# ⚙️ Настройки расписания",
    "",
    `<details open>\n<summary>Расписание</summary>`,
    "",
    `- Интервал: **${intervalMin} мин**`,
    `- Следующий автозапуск: ${nextLine}`,
    `- Сообщения автосинка: ${summaryLine}`,
    "",
    "</details>",
    "",
    "Выбери интервал или переключи уведомления:",
  ].join("\n");
  return clipRichMarkdown(md);
}
