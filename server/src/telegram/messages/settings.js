import { escapeHtml, formatDateTimeLocal } from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";
import {
  EMOJI_SCHEDULE,
  EMOJI_SETTINGS,
  humanIntervalLabel,
} from "./copyStyle.js";

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
    ? "🔔 Уведомлять об автосинке: <b>да</b> — пришлю сводку в чат."
    : "🔕 Уведомлять об автосинке: <b>нет</b> — автосинк работает тихо.";
  const intervalHuman = humanIntervalLabel(intervalMin);
  return [
    `${EMOJI_SETTINGS} <b>Расписание</b>`,
    `${EMOJI_SCHEDULE} Интервал: ${intervalHuman} (${intervalMin} мин)`,
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
    ? "🔔 **да** — пришлю сводку в чат"
    : "🔕 **нет** — автосинк работает тихо";
  const intervalHuman = humanIntervalLabel(intervalMin);
  const md = [
    `# ${EMOJI_SETTINGS} Расписание`,
    "",
    `<details open>\n<summary>Расписание</summary>`,
    "",
    `- Интервал: **${intervalHuman}** (${intervalMin} мин)`,
    `- Следующий автозапуск: ${nextLine}`,
    `- Уведомлять об автосинке: ${summaryLine}`,
    "",
    "</details>",
    "",
    "Выбери интервал или переключи уведомления:",
  ].join("\n");
  return clipRichMarkdown(md);
}
