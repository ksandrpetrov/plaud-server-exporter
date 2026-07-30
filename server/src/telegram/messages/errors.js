import { clipRichMarkdown } from "../richFormat.js";
import { EMOJI_TREE, EMOJI_WARNING } from "./copyStyle.js";
import {
  SYNC_AUTH_REJECTED_HTML,
  SYNC_LOCK_BUSY_HTML,
  SYNC_NO_SESSION_HTML,
} from "./sync.js";

export const TREE_FILE_PICK_NO_CONTEXT_HTML = `${EMOJI_TREE} Сначала открой папку в <b>Дереве записей</b> и посмотри список с номерами.`;

export const TREE_FILE_PICK_NO_CONTEXT_RICH = clipRichMarkdown(
  `# ${EMOJI_TREE} Нет контекста\n\nСначала открой папку в **Дереве записей** и посмотри список с номерами.`
);

export const ERR_TREE_AUTO_SYNC_FAILED_HTML =
  `${EMOJI_WARNING} Не удалось дотянуть саммари — синк не завершился.\n` +
  "Открой дерево снова или нажми 🔄 Синхронизировать.";

export const ERR_TREE_AUTO_SYNC_FAILED_RICH = clipRichMarkdown(
  `# ${EMOJI_WARNING} Синк не помог\n\nНе удалось дотянуть саммари — синк не завершился.\n\nОткрой дерево снова или нажми 🔄 Синхронизировать.`
);

export const ERR_TREE_FILE_STILL_MISSING_HTML =
  `${EMOJI_TREE} Синк прошёл, но саммари так и не появилось.\n` +
  "Проверь, что запись есть в Plaud, и запусти синк ещё раз.";

export const ERR_TREE_FILE_STILL_MISSING_RICH = clipRichMarkdown(
  `# ${EMOJI_TREE} Саммари не найдено\n\nСинк прошёл, но саммари так и не появилось.\n\nПроверь, что запись есть в Plaud, и запусти синк ещё раз.`
);

export const ERR_TREE_SUMMARY_DELIVERY_HTML =
  `${EMOJI_WARNING} Не смог показать саммари в Telegram.\n` +
  "Проверь доступность Telegram и попробуй снова.";

export const ERR_TREE_SUMMARY_DELIVERY_RICH = clipRichMarkdown(
  `# ${EMOJI_WARNING} Не удалось открыть\n\nНе смог показать саммари в Telegram.\n\nПроверь доступность Telegram и попробуй снова.`
);

export const ERR_TREE_LOAD_HTML =
  `${EMOJI_WARNING} Не удалось загрузить дерево записей.\n` +
  "Попробуй через минуту или нажми 🔄 Синхронизировать.";

export const ERR_TREE_LOAD_RICH = clipRichMarkdown(
  `# ${EMOJI_WARNING} Дерево недоступно\n\nНе удалось загрузить дерево записей.\n\nПопробуй через минуту или нажми 🔄 Синхронизировать.`
);

export const TREE_QUIET_SYNC_TOAST = "🔍 Саммари нет на диске — синхронизирую…";

/**
 * Map quiet-sync bot outcome status to user-visible copy.
 *
 * @param {string} status
 * @returns {{ html: string; richMarkdown: string } | null}
 */
export function treeAutoSyncErrorForStatus(status) {
  switch (status) {
    case "no_session":
      return {
        html: SYNC_NO_SESSION_HTML,
        richMarkdown: clipRichMarkdown(
          `# ${EMOJI_WARNING} Сессия не найдена\n\nСессия Plaud не найдена на сервере. Выпусти сессию на Mac и скопируй на сервер.`
        ),
      };
    case "lock_busy":
      return {
        html: SYNC_LOCK_BUSY_HTML,
        richMarkdown: clipRichMarkdown(
          `# 🔒 Синк занят\n\nУже идёт другой синк. Попробуй через минуту.`
        ),
      };
    case "auth_rejected":
      return {
        html: SYNC_AUTH_REJECTED_HTML,
        richMarkdown: clipRichMarkdown(
          `# ${EMOJI_WARNING} Сессия отклонена\n\nPlaud отверг сессию. Перевыпусти сессию на Mac.`
        ),
      };
  }
  return null;
}

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
