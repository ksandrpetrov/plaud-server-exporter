import { blockquote, expandableBlockquote } from "../htmlFormat.js";
import {
  describeStatusVerdict,
  escapeHtml,
  formatDateTimeLocal,
} from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";

const BOT_COMMANDS_BLOCK =
  "Команды:\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка";

const BOT_FEATURES_BLOCK =
  "Что умею:\n" +
  "🔄 запустить синк по кнопке\n" +
  "📊 показать статус последнего синка\n" +
  "📁 откроить дерево синка и скачать .md по номеру в чате\n" +
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

export const BOT_WELCOME_RICH_MARKDOWN =
  "# 🛰 Plaud-экспортер на связи\n\n" +
  "Этот бот приватный: команды доступны только владельцу.\n\n" +
  "<details>\n<summary>Что умею</summary>\n\n" +
  "🔄 запустить синк по кнопке\n" +
  "📊 показать статус последнего синка\n" +
  "📁 откроить дерево синка и скачать .md по номеру в чате\n" +
  "⚙️ настроить интервал автоматического запуска\n\n" +
  "</details>\n\n" +
  "<details>\n<summary>Команды</summary>\n\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка\n\n" +
  "</details>";

export const BOT_HELP_HTML =
  "🛰 <b>Как пользоваться</b>\n\n" +
  expandableBlockquote(BOT_COMMANDS_BLOCK, { threshold: 3 }) +
  "\n\n" +
  expandableBlockquote(BOT_MENU_BLOCK, { threshold: 3 }) +
  "\n\n" +
  blockquote(TREE_PICK_TIP);

export const BOT_HELP_RICH_MARKDOWN =
  "# 🛰 Как пользоваться\n\n" +
  "<details>\n<summary>Команды</summary>\n\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка\n\n" +
  "</details>\n\n" +
  "<details>\n<summary>Через /menu доступно</summary>\n\n" +
  "🔄 запуск синка вручную\n" +
  "📊 статус последнего синка\n" +
  "📁 файлы: дерево синка и сводка vault\n" +
  "⚙️ настройки расписания (интервал автозапуска)\n\n" +
  "</details>\n\n" +
  "<details>\n<summary>Дерево синка</summary>\n\n" +
  "Открой папку — у записей будут номера. " +
  "Отправь цифру (1–30 на странице), чтобы получить .md: " +
  "если файла ещё нет на сервере, я сначала запущу синк, а потом пришлю его.\n\n" +
  "</details>\n\n" +
  ".md из бота открывается отформатированным во встроенном браузере Telegram.";

export const BOT_PRIVATE_HINT =
  "🛰 Этот бот приватный. Команды доступны только владельцу.";

export const BOT_UNKNOWN_COMMAND =
  "🛰 Не понял команду. Открой /menu или /help.";

export const MENU_HEADER = "🛰 <b>Plaud-экспортер.</b>";
export const MENU_CLOSED_TEXT = "🛰 Меню закрыто. Возвращайся командой /menu.";

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

function lastSyncSummaryLinePlain(status) {
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
  return `📊 Последний синк: ${formatDateTimeLocal(lastAt)} (${verdict}, ${counters}).`;
}

export function buildMainMenuRichMarkdown(status) {
  return clipRichMarkdown(
    `# 🛰 Plaud-экспортер\n\n${lastSyncSummaryLinePlain(status)}\n\nВыбери действие:`
  );
}
