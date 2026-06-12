/**
 * Inline-keyboard factories.
 *
 * Each function returns a Telegram `InlineKeyboardMarkup` object directly
 * consumable by `telegramClient.sendMessage({ replyMarkup })`. Keep callback
 * payloads short: Telegram limits `callback_data` to 64 bytes.
 *
 * Layout mirrors `satellite/satellite/messages_ru.py` (one action per row,
 * navigation at the bottom).
 */

import {
  CB_BACK,
  CB_CLOSE,
  CB_FILES,
  CB_FILES_STATS,
  CB_FILES_TREE,
  CB_HELP,
  CB_RUN_SYNC,
  CB_SETTINGS,
  CB_SETTINGS_INTERVAL_120,
  CB_SETTINGS_INTERVAL_240,
  CB_SETTINGS_INTERVAL_480,
  CB_SETTINGS_INTERVAL_60,
  CB_SETTINGS_TOGGLE_SUMMARY,
  CB_STATUS,
  filesTreeFolderCallback,
} from "./callbackData.js";
import { INTERVAL_PRESETS_MIN } from "./botSettings.js";

export function buildMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔄 Запустить синк сейчас",
          callback_data: CB_RUN_SYNC,
          style: "primary",
        },
      ],
      [{ text: "📊 Статус последнего синка", callback_data: CB_STATUS }],
      [{ text: "📁 Файлы", callback_data: CB_FILES }],
      [{ text: "⚙️ Настройки расписания", callback_data: CB_SETTINGS }],
      [{ text: "ℹ️ Помощь", callback_data: CB_HELP }],
    ],
  };
}

export function buildBackToMenuKeyboard() {
  return {
    inline_keyboard: [[{ text: "⬅️ В меню", callback_data: CB_BACK }]],
  };
}

export function buildFilesMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🌳 Дерево синка", callback_data: CB_FILES_TREE },
        { text: "📊 Сводка vault", callback_data: CB_FILES_STATS },
      ],
      [{ text: "⬅️ В меню", callback_data: CB_BACK }],
    ],
  };
}

/**
 * Tree root keyboard: one button per folder (drills into a paginated folder
 * view), with the main-menu back button last. Each folder button is rendered
 * on its own row so long labels (e.g. "SocServ QA Cap…") don't wrap awkwardly.
 *
 * @param {import("./vaultTree.js").SyncIndexTreeRoot} root
 */
export function buildFilesTreeRootKeyboard(root) {
  const folders = root?.folders || [];
  const rows = folders.map((f, idx) => [
    {
      text: `📁 ${f.folder} (${f.count})`,
      callback_data: filesTreeFolderCallback(idx, 1),
    },
  ]);
  rows.push([{ text: "⬅️ В меню", callback_data: CB_BACK }]);
  return { inline_keyboard: rows };
}

/**
 * Tree folder keyboard: prev/next inside the current folder, plus a row to go
 * back to the folder list (К папкам) or all the way out to the main menu.
 *
 * The page indicator is in the message header instead of a noop button.
 *
 * @param {{ folderIndex?: number; page?: number; totalPages?: number }} folderPage
 */
export function buildFilesTreeFolderKeyboard(folderPage) {
  const totalPages = Math.max(1, Number(folderPage?.totalPages) || 1);
  const curPage = Math.min(
    Math.max(1, Number(folderPage?.page) || 1),
    totalPages
  );
  const folderIndex = Math.max(
    0,
    Math.floor(Number(folderPage?.folderIndex) || 0)
  );
  const rows = [];

  if (totalPages > 1) {
    const navRow = [];
    if (curPage > 1) {
      navRow.push({
        text: "◀️ Пред.",
        callback_data: filesTreeFolderCallback(folderIndex, curPage - 1),
      });
    }
    if (curPage < totalPages) {
      navRow.push({
        text: "След. ▶️",
        callback_data: filesTreeFolderCallback(folderIndex, curPage + 1),
      });
    }
    if (navRow.length > 0) rows.push(navRow);
  }

  rows.push([
    { text: "📁 К папкам", callback_data: CB_FILES_TREE },
    { text: "⬅️ В меню", callback_data: CB_BACK },
  ]);
  return { inline_keyboard: rows };
}

export function buildSyncFinishedKeyboard() {
  return buildBackToMenuKeyboard();
}

export function buildSyncRunningKeyboard() {
  return {
    inline_keyboard: [[{ text: "⏳ Идёт синк…", callback_data: CB_RUN_SYNC }]],
  };
}

/**
 * Settings screen: interval presets + scheduled-summary toggle + back button.
 * Highlights the active interval with a leading checkmark, the same
 * convention as digest_days_keyboard in satellite. The toggle button renders
 * its own state in the label so the user sees what tapping it will switch to
 * without re-reading the screen body.
 *
 * @param {number} activeIntervalMin
 * @param {boolean} [scheduledSummaryVisible]
 */
export function buildSettingsKeyboard(
  activeIntervalMin,
  scheduledSummaryVisible = false
) {
  const presetToCallback = {
    60: CB_SETTINGS_INTERVAL_60,
    120: CB_SETTINGS_INTERVAL_120,
    240: CB_SETTINGS_INTERVAL_240,
    480: CB_SETTINGS_INTERVAL_480,
  };
  const buttons = INTERVAL_PRESETS_MIN.map((min) => {
    const isActive = min === activeIntervalMin;
    const label = isActive ? `✅ ${min} мин` : `${min} мин`;
    return {
      text: label,
      callback_data: presetToCallback[min],
      ...(isActive ? { style: "success" } : {}),
    };
  });
  const summaryLabel = scheduledSummaryVisible
    ? "🔔 Сообщения автосинка: вкл"
    : "🔕 Сообщения автосинка: выкл";
  return {
    inline_keyboard: [
      [buttons[0], buttons[1]],
      [buttons[2], buttons[3]],
      [{ text: summaryLabel, callback_data: CB_SETTINGS_TOGGLE_SUMMARY }],
      [{ text: "⬅️ Назад", callback_data: CB_BACK }],
    ],
  };
}

export function buildCloseKeyboard() {
  return {
    inline_keyboard: [[{ text: "⬅️ Закрыть", callback_data: CB_CLOSE }]],
  };
}
