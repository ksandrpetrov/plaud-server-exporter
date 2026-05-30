import { describeStatusVerdict, escapeHtml, formatDateTimeLocal } from "./format.js";

export const SYNC_LOADING_HTML =
  "🛰 <b>Запускаю синк…</b>\nЭто может занять до минуты.";
export const SYNC_LOADING_SCHEDULED_HTML =
  "🕒 <b>Автозапуск синка по расписанию.</b>\nЭто может занять до минуты.";

export function syncFetchStatusHtml(source) {
  if (source === "scheduled") {
    return (
      "➡️ <b>Plaud готовит сводку по расписанию.</b>\n\n" +
      "Сейчас принесу результат."
    );
  }
  return "📅 <b>Plaud готовит сводку.</b>\n\nСейчас принесу результат.";
}

export function syncBusyText(source = "manual") {
  const prefix = source === "scheduled" ? "➡️" : "📅";
  return (
    `${prefix} Уже готовлю сводку или недавно прислала — подожди немного и попробуй снова.`
  );
}

export const SYNC_BUSY_TOAST = syncBusyText("manual");

export function syncLoadingPulseFrames(source) {
  const header =
    source === "scheduled"
      ? "➡️ <b>Автозапуск синка</b>"
      : "📅 <b>Запускаю синк</b>";
  return [
    `${header}\n<i>Это может занять до минуты.</i>`,
    `${header} .\n<i>Подключаюсь к Plaud…</i>`,
    `${header} . .\n<i>Получаю список записей…</i>`,
    `${header} . . .\n<i>Скачиваю саммари…</i>`,
  ];
}

export const SYNC_LOCK_BUSY_HTML =
  "🔒 Уже идёт другой синк. Попробуй через минуту.";
export const SYNC_NO_SESSION_HTML =
  "⚠️ Нет сохранённой сессии Plaud.\n" +
  "Запусти <code>npm run server:auth</code> на маке и скопируй session.json на сервер.";
export const SYNC_AUTH_REJECTED_HTML =
  "⚠️ Plaud отверг сессию. Перевыпусти её через <code>npm run server:auth</code>.";
export const SYNC_GENERIC_ERROR_HTML =
  "⚠️ Синк завершился с ошибкой.\nПодробности — в логах сервиса.";

export const STATUS_NEVER_RUN_HTML =
  "📊 <b>Статус</b>\n\nСинк ещё ни разу не запускался.";

export function syncSummaryHtml(stats, meta) {
  const header =
    meta.source === "scheduled"
      ? "🕒 <b>Автозапуск синка по расписанию.</b>"
      : "✅ <b>Синк завершён.</b>";
  const duration =
    typeof meta.durationSec === "number" && Number.isFinite(meta.durationSec)
      ? `\nЗатрачено ~${Math.max(1, Math.round(meta.durationSec))} с.`
      : "";
  const lines = [
    header + duration,
    "",
    `📥 Новых: ${stats.new ?? 0}`,
    `✏️ Обновлено: ${stats.updated ?? 0}`,
    `🟢 Без изменений: ${stats.unchanged ?? 0}`,
    `⏭ Пропущено: ${stats.skipped ?? 0}`,
    `⚠️ Ошибок: ${stats.errors ?? 0}`,
  ];
  if (stats.plaudChanged) {
    lines.push("", "⚠️ Plaud, похоже, поменял API — нужна ручная проверка.");
  }
  return lines.join("\n");
}

export function syncProgressHtml(stats) {
  const processed = Number(stats?.processed ?? 0);
  const total = Number(stats?.total ?? 0);
  if (total <= 0) {
    return `⏳ Идёт синк… обработано ${processed}.`;
  }
  return `⏳ Идёт синк… обработано ${processed} из ${total}.`;
}

export function statusScreenHtml(status) {
  if (!status?.lastSyncStats || !status?.lastSyncAt) {
    return STATUS_NEVER_RUN_HTML;
  }
  const stats = status.lastSyncStats;
  const lines = [
    "📊 <b>Статус последнего синка</b>",
    "",
    `🕘 Завершён: ${escapeHtml(formatDateTimeLocal(status.lastSyncAt))}`,
    `🏁 Итог: ${escapeHtml(describeStatusVerdict(stats.status))}`,
    `📥 Новых: ${stats.new ?? 0}`,
    `✏️ Обновлено: ${stats.updated ?? 0}`,
    `🟢 Без изменений: ${stats.unchanged ?? 0}`,
    `⏭ Пропущено: ${stats.skipped ?? 0}`,
    `⚠️ Ошибок: ${stats.errors ?? 0}`,
  ];
  if (status.lastAuthError?.message) {
    lines.push(
      "",
      `⚠️ Последняя ошибка авторизации: ${escapeHtml(status.lastAuthError.message)}`
    );
  }
  return lines.join("\n");
}
