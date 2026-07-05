import { blockquote, expandableBlockquote } from "../htmlFormat.js";
import { describeStatusVerdict, escapeHtml } from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";
import {
  EMOJI_BRAND,
  EMOJI_STATS,
  formatShortDateTimeLocal,
} from "./copyStyle.js";

const BOT_FEATURES_BLOCK =
  "🔄 синхронизировать саммари по кнопке\n" +
  "📊 показать статус последнего синка\n" +
  "📁 открыть дерево записей и скачать .md по номеру\n" +
  "⚙️ настроить расписание автосинка";

const TREE_PICK_TIP =
  "Открой папку в <b>Дереве записей</b> — у каждой записи будет номер. " +
  "Отправь цифру (1–30 на странице), чтобы получить .md в чат.";

export const BOT_WELCOME_HTML =
  `${EMOJI_BRAND} <b>Plaud-экспортер на связи.</b>\n\n` +
  "Приватный бот: команды доступны только владельцу.\n\n" +
  expandableBlockquote(BOT_FEATURES_BLOCK, { threshold: 3 });

export const BOT_WELCOME_RICH_MARKDOWN =
  `# ${EMOJI_BRAND} Plaud-экспортер на связи\n\n` +
  "Приватный бот: команды доступны только владельцу.\n\n" +
  "<details>\n<summary>Возможности</summary>\n\n" +
  "🔄 синхронизировать саммари по кнопке\n" +
  "📊 показать статус последнего синка\n" +
  "📁 открыть дерево записей и скачать .md по номеру\n" +
  "⚙️ настроить расписание автосинка\n\n" +
  "</details>";

export const BOT_HELP_HTML =
  `${EMOJI_BRAND} <b>Как пользоваться</b>\n\n` +
  "Команды:\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка\n\n" +
  blockquote(TREE_PICK_TIP);

export const BOT_HELP_RICH_MARKDOWN =
  `# ${EMOJI_BRAND} Как пользоваться\n\n` +
  "Команды:\n" +
  "/menu — главное меню\n" +
  "/status — статус последнего синка\n" +
  "/help — справка\n\n" +
  "<details>\n<summary>Как скачать запись</summary>\n\n" +
  "Открой папку в **Дереве записей** — у каждой записи будет номер. " +
  "Отправь цифру (1–30 на странице), чтобы получить .md в чат. " +
  "Если файла ещё нет на сервере, я сначала синхронизирую, а потом пришлю его.\n\n" +
  "</details>\n\n" +
  ".md из бота открывается отформатированным во встроенном браузере Telegram.";

export const BOT_UNKNOWN_COMMAND = `${EMOJI_BRAND} Не понял команду. Открой /menu или /help.`;

export const MENU_HEADER = `${EMOJI_BRAND} <b>Plaud-экспортер.</b>`;

export function lastSyncSummaryLine(status) {
  const lastStats = status?.lastSyncStats;
  const lastAt = status?.lastSyncAt;
  if (!lastStats || !lastAt) {
    return `${EMOJI_STATS} Последний синк: ещё не синхронизировал.`;
  }
  const verdict = describeStatusVerdict(lastStats.status);
  const newCount = lastStats.new ?? 0;
  const when = escapeHtml(formatShortDateTimeLocal(lastAt));
  return `${EMOJI_STATS} Последний синк: ${when} · ${escapeHtml(verdict)} · +${newCount} новых`;
}

function lastSyncSummaryLinePlain(status) {
  const lastStats = status?.lastSyncStats;
  const lastAt = status?.lastSyncAt;
  if (!lastStats || !lastAt) {
    return `${EMOJI_STATS} Последний синк: ещё не синхронизировал.`;
  }
  const verdict = describeStatusVerdict(lastStats.status);
  const newCount = lastStats.new ?? 0;
  const when = formatShortDateTimeLocal(lastAt);
  return `${EMOJI_STATS} Последний синк: ${when} · ${verdict} · +${newCount} новых`;
}

export function buildMainMenuRichMarkdown(status) {
  return clipRichMarkdown(
    `# ${EMOJI_BRAND} Plaud-экспортер\n\n${lastSyncSummaryLinePlain(status)}\n\nВыбери действие:`
  );
}

export const STALE_CALLBACK_TOAST = "Кнопка устарела — открой /menu";
