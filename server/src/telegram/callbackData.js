/**
 * Inline keyboard callback protocol.
 *
 * Telegram limits `callback_data` to 64 bytes; keep CB_* tokens short.
 * Anything that needs to round-trip non-trivial state encodes that state
 * compactly here so handlers don't have to.
 *
 * Kept separate from `messages.js` (user-facing copy) and `keyboards.js`
 * (button layout) so editing copy can never break the wire protocol.
 */

export const CB_RUN_SYNC = "run_sync";
export const CB_STATUS = "status";
export const CB_SETTINGS = "settings";
export const CB_SETTINGS_INTERVAL_60 = "settings_interval_60";
export const CB_SETTINGS_INTERVAL_120 = "settings_interval_120";
export const CB_SETTINGS_INTERVAL_240 = "settings_interval_240";
export const CB_SETTINGS_INTERVAL_480 = "settings_interval_480";
export const CB_SETTINGS_TOGGLE_SUMMARY = "settings_toggle_summary";
export const CB_FILES = "files";
export const CB_FILES_TREE = "files_tree";
export const CB_FILES_TREE_FOLDER_PREFIX = "tf:";
export const CB_BACK = "back";
export const CB_BACK_FILES = "back_files";
export const CB_HELP = "help";

/**
 * Build the callback_data payload for opening a folder page in the tree.
 * Encodes folder by its 0-based index in the canonical sorted folder list so
 * the payload stays short (e.g. `tf:5:2` for folder 5 / page 2). Well under
 * Telegram's 64-byte callback_data limit.
 *
 * @param {number} folderIndex
 * @param {number} page
 * @returns {string}
 */
export function filesTreeFolderCallback(folderIndex, page) {
  const idx = Math.max(0, Math.floor(Number(folderIndex) || 0));
  const p = Math.max(1, Math.floor(Number(page) || 1));
  return `${CB_FILES_TREE_FOLDER_PREFIX}${idx}:${p}`;
}

/**
 * Parse a `tf:<folderIndex>:<page>` callback_data payload.
 *
 * @param {string} data
 * @returns {{ folderIndex: number; page: number } | null}
 */
export function parseFilesTreeFolderCallback(data) {
  const s = String(data || "");
  if (!s.startsWith(CB_FILES_TREE_FOLDER_PREFIX)) return null;
  const rest = s.slice(CB_FILES_TREE_FOLDER_PREFIX.length);
  const m = /^(\d+):(\d+)$/.exec(rest);
  if (!m) return null;
  const folderIndex = Number.parseInt(m[1], 10);
  const page = Number.parseInt(m[2], 10);
  if (!Number.isFinite(folderIndex) || folderIndex < 0) return null;
  if (!Number.isFinite(page) || page < 1) return null;
  return { folderIndex, page };
}
