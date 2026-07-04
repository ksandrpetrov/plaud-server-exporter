/**
 * Inline-keyboard factories.
 *
 * Each function returns a Telegram `InlineKeyboardMarkup` object directly
 * consumable by `telegramClient.sendMessage({ replyMarkup })`. Keep callback
 * payloads short: Telegram limits `callback_data` to 64 bytes.
 */

import {
  CB_BACK,
  CB_BACK_FILES,
  CB_FILES,
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
import { humanIntervalLabel } from "./messages/copyStyle.js";

export function buildMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔄 Синхронизировать",
          callback_data: CB_RUN_SYNC,
          style: "primary",
        },
      ],
      [{ text: "📊 Статус", callback_data: CB_STATUS }],
      [{ text: "📁 Файлы", callback_data: CB_FILES }],
      [{ text: "⚙️ Расписание", callback_data: CB_SETTINGS }],
      [{ text: "ℹ️ Помощь", callback_data: CB_HELP }],
    ],
  };
}

export function buildBackToMenuKeyboard() {
  return {
    inline_keyboard: [[{ text: "⬅️ В меню", callback_data: CB_BACK }]],
  };
}

export function buildBackToFilesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⬅️ К файлам", callback_data: CB_BACK_FILES }],
      [{ text: "⬅️ В меню", callback_data: CB_BACK }],
    ],
  };
}

/**
 * Tree root keyboard: one button per folder (drills into a paginated folder
 * view), with navigation at the bottom.
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
  rows.push(
    [{ text: "⬅️ К файлам", callback_data: CB_BACK_FILES }],
    [{ text: "⬅️ В меню", callback_data: CB_BACK }]
  );
  return { inline_keyboard: rows };
}

export function buildFilesTreeEmptyKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔄 Синхронизировать",
          callback_data: CB_RUN_SYNC,
          style: "primary",
        },
      ],
      [{ text: "⬅️ К файлам", callback_data: CB_BACK_FILES }],
    ],
  };
}

/**
 * Tree folder keyboard: prev/next inside the current folder, plus a row to go
 * back to the folder list (К папкам) or all the way out to the main menu.
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
    { text: "⬅️ К файлам", callback_data: CB_BACK_FILES },
  ]);
  rows.push([{ text: "⬅️ В меню", callback_data: CB_BACK }]);
  return { inline_keyboard: rows };
}

export function buildSyncFinishedKeyboard() {
  return buildBackToMenuKeyboard();
}

export function buildTreePickErrorKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🌳 К дереву", callback_data: CB_FILES_TREE }],
      [{ text: "⬅️ В меню", callback_data: CB_BACK }],
    ],
  };
}

export function buildTreePickSuccessKeyboard() {
  return buildTreePickErrorKeyboard();
}

/**
 * Settings screen: interval presets + scheduled-summary toggle + back button.
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
    const human = humanIntervalLabel(min);
    const label = isActive ? `✅ ${human}` : `${human} · ${min} мин`;
    return {
      text: label,
      callback_data: presetToCallback[min],
      ...(isActive ? { style: "success" } : {}),
    };
  });
  const summaryLabel = scheduledSummaryVisible
    ? "🔔 Уведомлять об автосинке: да"
    : "🔕 Уведомлять об автосинке: нет";
  return {
    inline_keyboard: [
      [buttons[0], buttons[1]],
      [buttons[2], buttons[3]],
      [{ text: summaryLabel, callback_data: CB_SETTINGS_TOGGLE_SUMMARY }],
      [{ text: "⬅️ В меню", callback_data: CB_BACK }],
    ],
  };
}
