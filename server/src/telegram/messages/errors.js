export const TREE_FILE_PICK_NO_CONTEXT_HTML =
  "🌳 Сначала открой папку в <b>Дереве синка</b> и посмотри список с номерами.";

export const TREE_FILE_PICK_AUTO_SYNC_STARTED_HTML =
  "🌳 Файл не найден на сервере. Запустил синк через 🔄. Скоро пришлю вам файл.";

export const ERR_TREE_AUTO_SYNC_FAILED_HTML =
  "⚠️ Не удалось дотянуть файл — синк не завершился.\n" +
  "Попробуй 🔄 в меню или повтори цифру через минуту.";

/** @deprecated use ERR_TREE_AUTO_SYNC_FAILED_HTML */
export const TREE_FILE_PICK_AUTO_SYNC_FAILED_HTML =
  ERR_TREE_AUTO_SYNC_FAILED_HTML;

export const ERR_TREE_FILE_STILL_MISSING_HTML =
  "🌳 Синк прошёл, но файл так и не появился.\n" +
  "Проверь, что запись есть в Plaud, и запусти синк ещё раз.";

/** @deprecated use ERR_TREE_FILE_STILL_MISSING_HTML */
export const TREE_FILE_PICK_STILL_MISSING_HTML =
  ERR_TREE_FILE_STILL_MISSING_HTML;

export const ERR_TREE_SEND_DOCUMENT_HTML =
  "⚠️ Не смог отправить файл в Telegram.\n" +
  "Проверь, что .md на диске доступен серверу, и попробуй снова.";

export const ERR_TREE_LOAD_HTML =
  "⚠️ Не удалось загрузить дерево синка.\nПопробуй через минуту или запусти 🔄.";
