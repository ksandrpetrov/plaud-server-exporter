import { expandableBlockquote } from "../htmlFormat.js";
import {
  clipTelegramText,
  describeStatusVerdict,
  escapeHtml,
  formatDateTimeLocal,
} from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";

const SYNC_PROGRESS_STEPS = [
  "Подключение к Plaud",
  "Список записей",
  "Скачивание саммари",
];

/**
 * @param {object} [_stats]
 * @returns {string}
 */
export function syncProgressChecklistMarkdown(_stats) {
  return SYNC_PROGRESS_STEPS.map((label, i) => {
    const mark = i < 2 ? "x" : " ";
    return `- [${mark}] ${label}`;
  }).join("\n");
}

export const SYNC_LOADING_HTML =
  "🛰 <b>Запускаю синк…</b>\nЭто может занять до минуты.";
export const SYNC_LOADING_SCHEDULED_HTML =
  "🕒 <b>Автозапуск синка по расписанию.</b>\nЭто может занять до минуты.";

export function syncBusyText(source = "manual") {
  const prefix = source === "scheduled" ? "➡️" : "📅";
  return `${prefix} Уже готовлю сводку или недавно прислала — подожди немного и попробуй снова.`;
}

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

/**
 * Rich-markdown pulse frames (task-list checklist) for sendRichMessageDraft.
 *
 * @param {"manual" | "scheduled"} source
 * @returns {string[]}
 */
export function syncChecklistRichFrames(source) {
  const header =
    source === "scheduled" ? "## ➡️ Автозапуск синка" : "## 📅 Запускаю синк";
  const steps = [
    "Подключаюсь к Plaud…",
    "Получаю список записей…",
    "Скачиваю саммари…",
  ];
  /** @type {string[]} */
  const frames = [`${header}\n\n*Это может занять до минуты.*`];
  for (let i = 0; i < steps.length; i++) {
    const tasks = steps.map((label, j) => {
      const mark = j <= i ? "x" : " ";
      return `- [${mark}] ${label}`;
    });
    frames.push(`${header}\n\n${tasks.join("\n")}`);
  }
  return frames;
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

/**
 * @param {object} stats
 * @param {{ source?: string; durationSec?: number }} meta
 * @returns {string}
 */
export function syncSummaryRichMarkdown(stats, meta) {
  const header =
    meta.source === "scheduled"
      ? "# 🕒 Автозапуск синка по расписанию"
      : "# ✅ Синк завершён";
  const duration =
    typeof meta.durationSec === "number" && Number.isFinite(meta.durationSec)
      ? `\n\nЗатрачено ~${Math.max(1, Math.round(meta.durationSec))} с.`
      : "";
  const table = [
    "| Метрика | Значение |",
    "| --- | --- |",
    `| Новых | ${stats.new ?? 0} |`,
    `| Обновлено | ${stats.updated ?? 0} |`,
    `| Без изменений | ${stats.unchanged ?? 0} |`,
    `| Пропущено | ${stats.skipped ?? 0} |`,
    `| Ошибок | ${stats.errors ?? 0} |`,
  ].join("\n");
  let md = `${header}${duration}\n\n${table}`;
  const skipped = Number(stats?.skipped ?? 0);
  const errors = Number(stats?.errors ?? 0);
  if (skipped > 0 || errors > 0) {
    const lines = [];
    if (skipped > 0) lines.push(`- Пропущено: ${skipped}`);
    if (errors > 0) lines.push(`- Ошибок: ${errors}`);
    md += `\n\n<details open>\n<summary>Детали</summary>\n\n${lines.join("\n")}\n\n</details>`;
  }
  if (stats.plaudChanged) {
    md += "\n\n> ⚠️ Plaud, похоже, поменял API — нужна ручная проверка.";
  }
  return clipRichMarkdown(md);
}

export function syncProgressHtml(stats) {
  const processed = Number(stats?.processed ?? 0);
  const total = Number(stats?.total ?? 0);
  const pct = total > 0 ? ` (${Math.round((processed / total) * 100)}%)` : "";
  const counter =
    total <= 0
      ? `обработано ${processed}`
      : `обработано ${processed} из ${total}${pct}`;
  const lines = [`⏳ <b>Идёт синк…</b>`, counter];
  const lastMessage = String(stats?.lastMessage || "").trim();
  if (lastMessage) {
    lines.push(
      "",
      expandableBlockquote(escapeHtml(lastMessage), { threshold: 1 })
    );
  }
  return clipTelegramText(lines.join("\n"));
}

/**
 * @param {object} stats
 * @returns {string}
 */
export function syncProgressRichMarkdown(stats) {
  const processed = Number(stats?.processed ?? 0);
  const total = Number(stats?.total ?? 0);
  const pct = total > 0 ? ` (${Math.round((processed / total) * 100)}%)` : "";
  const counter =
    total <= 0 ? `**${processed}**` : `**${processed} / ${total}**${pct}`;
  const parts = [
    "## ⏳ Идёт синк…",
    "",
    counter,
    "",
    syncProgressChecklistMarkdown(stats),
  ];
  const lastMessage = String(stats?.lastMessage || "").trim();
  if (lastMessage) {
    parts.push("", `> ${lastMessage.replace(/\n/g, " ")}`);
  }
  return clipRichMarkdown(parts.join("\n"));
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
    "",
    expandableBlockquote(
      [
        `📥 Новых: ${stats.new ?? 0}`,
        `✏️ Обновлено: ${stats.updated ?? 0}`,
        `🟢 Без изменений: ${stats.unchanged ?? 0}`,
        `⏭ Пропущено: ${stats.skipped ?? 0}`,
        `⚠️ Ошибок: ${stats.errors ?? 0}`,
      ].join("\n"),
      { threshold: 3 }
    ),
  ];
  if (status.lastAuthError?.message) {
    lines.push(
      "",
      `⚠️ Последняя ошибка авторизации: ${escapeHtml(status.lastAuthError.message)}`
    );
  }
  return lines.join("\n");
}

/**
 * @param {object} status
 * @returns {string}
 */
export function statusScreenRichMarkdown(status) {
  if (!status?.lastSyncStats || !status?.lastSyncAt) {
    return clipRichMarkdown("# 📊 Статус\n\nСинк ещё ни разу не запускался.");
  }
  const stats = status.lastSyncStats;
  const table = [
    "| Метрика | Значение |",
    "| --- | --- |",
    `| Завершён | ${formatDateTimeLocal(status.lastSyncAt)} |`,
    `| Итог | ${describeStatusVerdict(stats.status)} |`,
    `| Новых | ${stats.new ?? 0} |`,
    `| Обновлено | ${stats.updated ?? 0} |`,
    `| Без изменений | ${stats.unchanged ?? 0} |`,
    `| Пропущено | ${stats.skipped ?? 0} |`,
    `| Ошибок | ${stats.errors ?? 0} |`,
  ].join("\n");
  let md = `# 📊 Статус последнего синка\n\n${table}`;
  if (status.lastAuthError?.message) {
    md += `\n\n> ⚠️ Последняя ошибка авторизации: ${status.lastAuthError.message}`;
  }
  return clipRichMarkdown(md);
}
