/**
 * Russian user-facing strings and callback-data constants for the Telegram bot.
 *
 * Edit copy here only — handlers and keyboards reference the constants, so we
 * never inline button labels or callback strings. Telegram limits
 * `callback_data` to 64 bytes; keep CB_* tokens short.
 *
 * The visual style and tone follow `satellite/satellite/messages_ru.py`:
 * single short status line, single concise instruction, HTML where needed.
 */

export const CB_RUN_SYNC = "run_sync";
export const CB_STATUS = "status";
export const CB_SETTINGS = "settings";
export const CB_SETTINGS_INTERVAL_60 = "settings_interval_60";
export const CB_SETTINGS_INTERVAL_120 = "settings_interval_120";
export const CB_SETTINGS_INTERVAL_240 = "settings_interval_240";
export const CB_SETTINGS_INTERVAL_480 = "settings_interval_480";
export const CB_FILES = "files";
export const CB_FILES_TREE = "files_tree";
export const CB_FILES_STATS = "files_stats";
export const CB_BACK = "back";
export const CB_HELP = "help";
export const CB_CLOSE = "close";

export const INTERVAL_PRESETS_MIN = [60, 120, 240, 480];

export const BOT_WELCOME_HTML =
  "🛰 <b>Plaud-экспортер на связи.</b>\n\n" +
  "Этот бот приватный: команды доступны только владельцу.\n" +
  "Что умею:\n" +
  "🔄 запустить синк по кнопке\n" +
  "📊 показать статус последнего синка\n" +
  "⚙️ настроить интервал автоматического запуска\n\n" +
  "Команды:\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка";

export const BOT_HELP_HTML =
  "🛰 <b>Как пользоваться</b>\n\n" +
  "Команды:\n" +
  "/menu — открыть главное меню\n" +
  "/status — посмотреть, когда был последний синк\n" +
  "/help — эта справка\n\n" +
  "Через /menu доступно:\n" +
  "🔄 запуск синка вручную\n" +
  "📊 статус последнего синка\n" +
  "⚙️ настройки расписания (интервал автозапуска)";

export const BOT_PRIVATE_HINT =
  "🛰 Этот бот приватный. Команды доступны только владельцу.";

export const BOT_UNKNOWN_COMMAND =
  "🛰 Не понял команду. Открой /menu или /help.";

export const MENU_HEADER = "🛰 <b>Plaud-экспортер.</b>";

export const SYNC_LOADING_HTML =
  "🛰 <b>Запускаю синк…</b>\nЭто может занять до минуты.";
export const SYNC_LOADING_SCHEDULED_HTML =
  "🕒 <b>Автозапуск синка по расписанию.</b>\nЭто может занять до минуты.";
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
    default:
      return describeStatusVerdict(rawStatus);
  }
}

export function filesMenuHtml() {
  return FILES_MENU_HEADER;
}

/**
 * @param {import("./vaultTree.js").SyncIndexTree} tree
 */
export function filesTreeHtml(tree) {
  if (!tree?.total) {
    return FILES_TREE_EMPTY;
  }
  const lines = [`🌳 <b>Дерево синка</b> (всего ${tree.total})`, ""];
  let rowsUsed = 0;
  const maxRows = 30;

  for (const group of tree.groups || []) {
    const yearLabel = escapeHtml(group.year);
    lines.push(`<b>${yearLabel}</b> — ${group.count} записей`);
    for (const item of group.items || []) {
      if (rowsUsed >= maxRows) break;
      const status = escapeHtml(describeRecordStatus(item.status));
      const date = escapeHtml(item.date);
      const title = escapeHtml(item.title);
      lines.push(`  • ${date} — ${title} [${status}]`);
      rowsUsed++;
    }
    if (rowsUsed >= maxRows) break;
    lines.push("");
  }

  if (tree.truncated) {
    const hidden = Math.max(0, tree.total - rowsUsed);
    if (hidden > 0) {
      lines.push(`… ещё ${hidden} (показано ${rowsUsed} из ${tree.total})`);
    }
  }

  return truncateTelegramHtml(lines.join("\n").trimEnd());
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
