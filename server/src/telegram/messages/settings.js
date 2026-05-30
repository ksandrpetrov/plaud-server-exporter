import { escapeHtml, formatDateTimeLocal } from "./format.js";

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
