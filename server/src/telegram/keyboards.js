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
  CB_STATUS,
  INTERVAL_PRESETS_MIN,
  filesTreePageCallback,
} from "./messages.js";

export function buildMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔄 Запустить синк сейчас", callback_data: CB_RUN_SYNC }],
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
 * Tree pagination keyboard: prev/next on top, back to menu below.
 *
 * The "page X/Y" indicator is rendered in the message header (not as a button)
 * so we don't need a noop callback; we just hide prev/next at the edges.
 *
 * @param {{ page?: number; totalPages?: number }} tree
 */
export function buildFilesTreeKeyboard(tree) {
  const totalPages = Math.max(1, Number(tree?.totalPages) || 1);
  const page = Math.min(Math.max(1, Number(tree?.page) || 1), totalPages);
  const rows = [];
  if (totalPages > 1) {
    const navRow = [];
    if (page > 1) {
      navRow.push({
        text: "◀️ Пред.",
        callback_data: filesTreePageCallback(page - 1),
      });
    }
    if (page < totalPages) {
      navRow.push({
        text: "След. ▶️",
        callback_data: filesTreePageCallback(page + 1),
      });
    }
    if (navRow.length > 0) rows.push(navRow);
  }
  rows.push([{ text: "⬅️ В меню", callback_data: CB_BACK }]);
  return { inline_keyboard: rows };
}

export function buildSyncFinishedKeyboard() {
  return buildBackToMenuKeyboard();
}

export function buildSyncRunningKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⏳ Идёт синк…", callback_data: CB_RUN_SYNC }],
    ],
  };
}

/**
 * Settings screen: interval presets + back button. Highlights the active one
 * with a leading checkmark, the same convention as digest_days_keyboard in
 * satellite.
 *
 * @param {number} activeIntervalMin
 */
export function buildSettingsKeyboard(activeIntervalMin) {
  const presetToCallback = {
    60: CB_SETTINGS_INTERVAL_60,
    120: CB_SETTINGS_INTERVAL_120,
    240: CB_SETTINGS_INTERVAL_240,
    480: CB_SETTINGS_INTERVAL_480,
  };
  const buttons = INTERVAL_PRESETS_MIN.map((min) => {
    const isActive = min === activeIntervalMin;
    const label = isActive ? `✅ ${min} мин` : `${min} мин`;
    return { text: label, callback_data: presetToCallback[min] };
  });
  return {
    inline_keyboard: [
      [buttons[0], buttons[1]],
      [buttons[2], buttons[3]],
      [{ text: "⬅️ Назад", callback_data: CB_BACK }],
    ],
  };
}

export function buildCloseKeyboard() {
  return {
    inline_keyboard: [[{ text: "⬅️ Закрыть", callback_data: CB_CLOSE }]],
  };
}
