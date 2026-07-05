import { clipRichMarkdown } from "../richFormat.js";
import { EMOJI_TREE, EMOJI_WARNING } from "./copyStyle.js";

export const TREE_FILE_PICK_NO_CONTEXT_HTML = `${EMOJI_TREE} Сначала открой папку в <b>Дереве записей</b> и посмотри список с номерами.`;

export const TREE_FILE_PICK_NO_CONTEXT_RICH = clipRichMarkdown(
  `# ${EMOJI_TREE} Нет контекста\n\nСначала открой папку в **Дереве записей** и посмотри список с номерами.`
);

export const ERR_TREE_AUTO_SYNC_FAILED_HTML =
  `${EMOJI_WARNING} Не удалось дотянуть файл — синк не завершился.\n` +
  "Открой дерево снова или нажми 🔄 Синхронизировать.";

export const ERR_TREE_AUTO_SYNC_FAILED_RICH = clipRichMarkdown(
  `# ${EMOJI_WARNING} Синк не помог\n\nНе удалось дотянуть файл — синк не завершился.\n\nОткрой дерево снова или нажми 🔄 Синхронизировать.`
);

export const ERR_TREE_FILE_STILL_MISSING_HTML =
  `${EMOJI_TREE} Синк прошёл, но файл так и не появился.\n` +
  "Проверь, что запись есть в Plaud, и запусти синк ещё раз.";

export const ERR_TREE_FILE_STILL_MISSING_RICH = clipRichMarkdown(
  `# ${EMOJI_TREE} Файл не найден\n\nСинк прошёл, но файл так и не появился.\n\nПроверь, что запись есть в Plaud, и запусти синк ещё раз.`
);

export const ERR_TREE_SEND_DOCUMENT_HTML =
  `${EMOJI_WARNING} Не смог отправить файл в Telegram.\n` +
  "Проверь, что .md на диске доступен серверу, и попробуй снова.";

export const ERR_TREE_SEND_DOCUMENT_RICH = clipRichMarkdown(
  `# ${EMOJI_WARNING} Не удалось отправить\n\nНе смог отправить файл в Telegram.\n\nПроверь, что .md на диске доступен серверу, и попробуй снова.`
);

export const ERR_TREE_LOAD_HTML =
  `${EMOJI_WARNING} Не удалось загрузить дерево записей.\n` +
  "Попробуй через минуту или нажми 🔄 Синхронизировать.";

export const ERR_TREE_LOAD_RICH = clipRichMarkdown(
  `# ${EMOJI_WARNING} Дерево недоступно\n\nНе удалось загрузить дерево записей.\n\nПопробуй через минуту или нажми 🔄 Синхронизировать.`
);

export const TREE_QUIET_SYNC_TOAST = "🔍 Файла нет на диске — синхронизирую…";

export const ERR_CALLBACK_HANDLER_TOAST =
  "Не удалось выполнить действие. Открой /menu и попробуй снова.";

/**
 * @param {string} title
 * @returns {string}
 */
export function treeDocumentSentHtml(title) {
  const safe = String(title || "Запись").trim() || "Запись";
  return `✅ Отправил «${safe}»`;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function treeDocumentSentRich(title) {
  const safe = String(title || "Запись").trim() || "Запись";
  return clipRichMarkdown(`# ✅ Отправил «${safe}»`);
}
