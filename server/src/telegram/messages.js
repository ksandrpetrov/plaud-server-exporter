/**
 * Russian user-facing strings for the Telegram bot.
 *
 * Edit copy here only — handlers and keyboards reference the constants, so we
 * never inline button labels.
 *
 * Callback protocol (CB_* tokens, `filesTreeFolderCallback`) lives in
 * `callbackData.js`. Scheduler presets live in `botSettings.js`. Import them
 * directly; do not add re-exports here.
 *
 * The visual style and tone follow `satellite/satellite/messages_ru.py`:
 * single short status line, single concise instruction, HTML where needed.
 */

import { blockquote, expandableBlockquote } from "./htmlFormat.js";

const BOT_COMMANDS_BLOCK =
  "Команды:\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка";

const BOT_FEATURES_BLOCK =
  "Что умею:\n" +
  "🔄 запустить синк по кнопке\n" +
  "📊 показать статус последнего синка\n" +
  "📁 открыть дерево синка и скачать .md по номеру в чате\n" +
  "⚙️ настроить интервал автоматического запуска";

const BOT_MENU_BLOCK =
  "Через /menu доступно:\n" +
  "🔄 запуск синка вручную\n" +
  "📊 статус последнего синка\n" +
  "📁 файлы: дерево синка и сводка vault\n" +
  "⚙️ настройки расписания (интервал автозапуска)";

const TREE_PICK_TIP =
  "В <b>Дереве синка</b> открой папку — у записей будут номера. " +
  "Отправь цифру (1–30 на странице), чтобы получить .md: если файла ещё нет на сервере, я сначала запущу синк, а потом пришлю его.";

export const BOT_WELCOME_HTML =
  "🛰 <b>Plaud-экспортер на связи.</b>\n\n" +
  "Этот бот приватный: команды доступны только владельцу.\n\n" +
  expandableBlockquote(BOT_FEATURES_BLOCK, { threshold: 3 }) +
  "\n\n" +
  expandableBlockquote(BOT_COMMANDS_BLOCK, { threshold: 3 });

export const BOT_HELP_HTML =
  "🛰 <b>Как пользоваться</b>\n\n" +
  expandableBlockquote(BOT_COMMANDS_BLOCK, { threshold: 3 }) +
  "\n\n" +
  expandableBlockquote(BOT_MENU_BLOCK, { threshold: 3 }) +
  "\n\n" +
  blockquote(TREE_PICK_TIP);

export const BOT_PRIVATE_HINT =
  "🛰 Этот бот приватный. Команды доступны только владельцу.";

export const BOT_UNKNOWN_COMMAND =
  "🛰 Не понял команду. Открой /menu или /help.";

export const MENU_HEADER = "🛰 <b>Plaud-экспортер.</b>";

export const SYNC_LOADING_HTML =
  "🛰 <b>Запускаю синк…</b>\nЭто может занять до минуты.";
export const SYNC_LOADING_SCHEDULED_HTML =
  "🕒 <b>Автозапуск синка по расписанию.</b>\nЭто может занять до минуты.";
export const SYNC_BUSY_TOAST = "Уже идёт синк — подожди немного";

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

export const SETTINGS_CLOSED_TEXT = "⚙️ Настройки закрыты.";
export const MENU_CLOSED_TEXT = "🛰 Меню закрыто. Возвращайся командой /menu.";

export const FILES_MENU_HEADER =
  "📁 <b>Файлы</b>\n\nВыбери, что показать:";
export const FILES_TREE_EMPTY =
  "🌳 <b>Дерево синка</b>\n\nПока пусто. Запусти синк через 🔄.";
export const FILES_STATS_EMPTY =
  "📊 <b>Сводка vault</b>\n\nПапка ещё не создана.";

/**
 * @param {string} input
 */
export function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Human-readable line for the menu header summarising the last sync.
 *
 * @param {object | null} status
 * @returns {string}
 */
export function lastSyncSummaryLine(status) {
  const lastStats = status?.lastSyncStats;
  const lastAt = status?.lastSyncAt;
  if (!lastStats || !lastAt) {
    return "📊 Последний синк: ещё не запускался.";
  }
  const verdict = describeStatusVerdict(lastStats.status);
  const counters =
    `+${lastStats.new ?? 0} новых, ` +
    `${lastStats.updated ?? 0} обновлено, ` +
    `${lastStats.errors ?? 0} ошибок`;
  return `📊 Последний синк: ${escapeHtml(formatDateTimeLocal(lastAt))} (${verdict}, ${counters}).`;
}

/**
 * @param {object} stats
 * @param {{ source: "manual" | "scheduled"; durationSec?: number | null }} meta
 */
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
 */
export function syncProgressHtml(stats) {
  const processed = Number(stats?.processed ?? 0);
  const total = Number(stats?.total ?? 0);
  if (total <= 0) {
    return `⏳ Идёт синк… обработано ${processed}.`;
  }
  return `⏳ Идёт синк… обработано ${processed} из ${total}.`;
}

/**
 * @param {object | null} status
 */
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

/**
 * @param {{ intervalMin: number; lastSyncAt: string | null; nowMs?: number }} params
 */
export function settingsScreenHtml({ intervalMin, lastSyncAt, nowMs }) {
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
  return [
    "⚙️ <b>Настройки расписания</b>",
    `🕒 Интервал автозапуска: ${intervalMin} мин`,
    nextLine,
    "",
    "Выбери интервал:",
  ].join("\n");
}

function describeStatusVerdict(rawStatus) {
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

/**
 * Format ISO timestamps as `YYYY-MM-DD HH:MM` in the local server timezone.
 * Telegram clients render messages in the user's timezone, but the bot lives
 * on the same VPS as the exporter, so we just keep it simple and explicit.
 *
 * @param {string} isoString
 */
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

const TELEGRAM_HTML_MAX_LEN = 3800;

/**
 * @param {string} html
 * @returns {string}
 */
export function truncateTelegramHtml(html) {
  const text = String(html || "");
  if (text.length <= TELEGRAM_HTML_MAX_LEN) return text;
  return `${text.slice(0, TELEGRAM_HTML_MAX_LEN - 1)}…`;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * @param {string} rawStatus
 * @returns {string}
 */
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

export function filesMenuHtml() {
  return FILES_MENU_HEADER;
}

const DIGIT_EMOJI = [
  "0\uFE0F\u20E3",
  "1\uFE0F\u20E3",
  "2\uFE0F\u20E3",
  "3\uFE0F\u20E3",
  "4\uFE0F\u20E3",
  "5\uFE0F\u20E3",
  "6\uFE0F\u20E3",
  "7\uFE0F\u20E3",
  "8\uFE0F\u20E3",
  "9\uFE0F\u20E3",
];

/**
 * Render a non-negative integer using keycap digit emoji (e.g. 12 → "1️⃣2️⃣").
 *
 * Used for *displaying* file numbers to the user; input parsing intentionally
 * still expects plain ASCII digits (see `parseTreeFilePickNumber`).
 *
 * @param {number} n
 * @returns {string}
 */
export function formatNumberEmoji(n) {
  const i = Math.floor(Number(n));
  if (!Number.isFinite(i) || i < 0) return "";
  return String(i)
    .split("")
    .map((d) => DIGIT_EMOJI[Number(d)] ?? d)
    .join("");
}

/**
 * @param {number} n 1-based index on the current tree page
 * @returns {string}
 */
export function treeListNumberPrefix(n) {
  const i = Math.floor(Number(n) || 0);
  if (i < 1) return "";
  return `${formatNumberEmoji(i)} -`;
}

/**
 * Removes a leading meeting date from the title when the tree line already
 * shows `date` separately (Plaud titles and filenames often repeat it).
 *
 * @param {string} date
 * @param {string} title
 * @returns {string}
 */
export function stripLeadingDateFromTreeTitle(date, title) {
  const d = String(date || "").trim();
  let t = String(title || "").trim();
  if (!d || !t) return t;
  if (t === d) return "";

  const stripPrefix = (prefix) => {
    if (t.startsWith(prefix)) t = t.slice(prefix.length).trim();
  };

  stripPrefix(`${d} | `);
  stripPrefix(`${d}|`);
  stripPrefix(`${d} — `);
  stripPrefix(`${d} - `);
  stripPrefix(`${d}—`);
  stripPrefix(`${d}-`);

  return t;
}

/**
 * @param {{ lineNum: number; date: string; title: string }} item
 * @returns {string} plain text (escape HTML before sending)
 */
export function formatTreeFolderItemLine({ lineNum, date, title }) {
  const prefix = treeListNumberPrefix(lineNum);
  const datePart = String(date || "").trim() || "—";
  const label = stripLeadingDateFromTreeTitle(datePart, title);
  if (!label) return `${prefix} ${datePart}`;
  return `${prefix} ${datePart} | ${label}`;
}

/**
 * @param {string} text
 * @returns {number | null} 1-based pick when the message is only digits
 */
export function parseTreeFilePickNumber(text) {
  const s = String(text || "");
  const m = /^(\d+)$/.exec(s);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export const TREE_FILE_PICK_NO_CONTEXT_HTML =
  "🌳 Сначала открой папку в <b>Дереве синка</b> и посмотри список с номерами.";

/**
 * @param {number} pick
 * @param {number} shown
 */
export function treeFilePickOutOfRangeHtml(pick, shown) {
  return `🌳 Нет файла №${formatNumberEmoji(pick)} на этой странице (показано ${shown}).`;
}

/**
 * Sent when the user picks a file that isn't on disk yet (either missing
 * after a manual delete or never synced). The bot follows up with an auto
 * sync and delivers the file once it lands.
 */
export const TREE_FILE_PICK_AUTO_SYNC_STARTED_HTML =
  "🌳 Файл не найден на сервере. Запустил синк через 🔄. Скоро пришлю вам файл.";

export const ERR_TREE_AUTO_SYNC_FAILED_HTML =
  "⚠️ Не удалось дотянуть файл — синк не завершился.\n" +
  "Попробуй 🔄 в меню или повтори цифру через минуту.";

/** @deprecated use ERR_TREE_AUTO_SYNC_FAILED_HTML */
export const TREE_FILE_PICK_AUTO_SYNC_FAILED_HTML = ERR_TREE_AUTO_SYNC_FAILED_HTML;

export const ERR_TREE_FILE_STILL_MISSING_HTML =
  "🌳 Синк прошёл, но файл так и не появился.\n" +
  "Проверь, что запись есть в Plaud, и запусти синк ещё раз.";

/** @deprecated use ERR_TREE_FILE_STILL_MISSING_HTML */
export const TREE_FILE_PICK_STILL_MISSING_HTML = ERR_TREE_FILE_STILL_MISSING_HTML;

export const ERR_TREE_SEND_DOCUMENT_HTML =
  "⚠️ Не смог отправить файл в Telegram.\n" +
  "Проверь, что .md на диске доступен серверу, и попробуй снова.";

export const ERR_TREE_LOAD_HTML =
  "⚠️ Не удалось загрузить дерево синка.\nПопробуй через минуту или запусти 🔄.";

/**
 * Root view of the tree: folder list with counts. Each folder is rendered as
 * a `📁 <name> — N записей` line; the navigation buttons (one per folder) are
 * built separately in `buildFilesTreeRootKeyboard`.
 *
 * @param {import("./vaultTree.js").SyncIndexTreeRoot} root
 */
export function filesTreeRootHtml(root) {
  if (!root?.total) {
    return FILES_TREE_EMPTY;
  }
  const folderCount = (root.folders || []).length;
  const lines = [
    `🌳 <b>Дерево синка</b>`,
    `Всего файлов: ${root.total}, папок: ${folderCount}.`,
    "",
  ];
  for (const f of root.folders || []) {
    const label = escapeHtml(f.folder || "");
    lines.push(`📁 <b>${label}</b> — ${f.count} записей`);
  }
  lines.push("", "Выбери папку, чтобы открыть список файлов.");
  return truncateTelegramHtml(lines.join("\n"));
}

/**
 * Drill-down view: paginated file listing inside one folder. The "ещё X"
 * hint shows how many records remain past the current page so the user knows
 * the prev/next buttons still have somewhere to go.
 *
 * @param {import("./vaultTree.js").SyncIndexFolderPage} folderPage
 */
export function filesTreeFolderHtml(folderPage) {
  const folderLabel = escapeHtml(folderPage?.folder || "");
  if (!folderPage?.exists) {
    return [
      `📁 <b>${folderLabel || "Папка"}</b>`,
      "",
      "В этой папке пока нет файлов.",
    ].join("\n");
  }
  const totalPages = Math.max(1, Number(folderPage.totalPages) || 1);
  const curPage = Math.min(Math.max(1, Number(folderPage.page) || 1), totalPages);
  const pageSize = Math.max(1, Number(folderPage.pageSize) || 30);
  const pageSuffix = totalPages > 1 ? ` — стр. ${curPage} из ${totalPages}` : "";

  const lines = [
    `📁 <b>${folderLabel}</b> (всего ${folderPage.total})${pageSuffix}`,
    "",
  ];

  let lineNum = 0;
  for (const item of folderPage.items || []) {
    lineNum += 1;
    const plain = formatTreeFolderItemLine({
      lineNum,
      date: item.date,
      title: item.title,
    });
    lines.push(escapeHtml(plain));
  }

  const startIdx = (curPage - 1) * pageSize;
  const shownTo = startIdx + (folderPage.items?.length || 0);
  const hidden = Math.max(0, folderPage.total - shownTo);
  if (hidden > 0) {
    const rangeFrom = startIdx + 1;
    lines.push(
      "",
      `… ещё ${hidden} (показано ${rangeFrom}–${shownTo} из ${folderPage.total})`
    );
  }

  return truncateTelegramHtml(lines.join("\n"));
}

/**
 * @param {import("./vaultTree.js").VaultSummary} stats
 */
export function filesStatsHtml(stats) {
  if (!stats?.exists) {
    return FILES_STATS_EMPTY;
  }

  const lines = [
    "📊 <b>Сводка vault</b>",
    "",
    `📂 Корень: ${escapeHtml(stats.subfolder)}/`,
    `📄 Файлов .md: ${stats.totalCount ?? 0}`,
    `💾 Суммарный размер: ${formatBytes(stats.totalBytes ?? 0)}`,
  ];

  if (stats.lastMtime) {
    lines.push(
      `🕘 Последнее изменение: ${escapeHtml(formatDateTimeLocal(stats.lastMtime))}`
    );
  }

  if (stats.scanTruncated) {
    lines.push("", "⚠️ Сканирование обрезано по лимиту файлов.");
  }

  const recent = stats.recent || [];
  if (recent.length > 0) {
    lines.push("", "Последние 10:");
    for (const file of recent) {
      const name = escapeHtml(file.relativePath);
      const size = formatBytes(file.size);
      lines.push(`  • ${name} (${size})`);
    }
  } else if (stats.totalCount === 0) {
    lines.push("", "Файлов .md пока нет.");
  }

  return truncateTelegramHtml(lines.join("\n"));
}
