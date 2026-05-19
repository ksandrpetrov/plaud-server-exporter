/**
 * Per-chat context for the sync tree folder listing: which page was last shown
 * and which files were numbered 1…N on that page. Used when the owner replies
 * with a digit to receive the matching .md file.
 */

/** @typedef {import("./vaultTree.js").TreeItem} TreeItem */

/**
 * @typedef {{
 *   folderIndex: number;
 *   page: number;
 *   items: TreeItem[];
 * }} TreeBrowseState
 */

/** @type {Map<number, TreeBrowseState>} */
const byChatId = new Map();

/**
 * @param {number} chatId
 * @param {TreeBrowseState} state
 */
export function setTreeBrowseState(chatId, state) {
  const id = Number(chatId);
  if (!Number.isInteger(id)) return;
  byChatId.set(id, {
    folderIndex: Math.floor(Number(state.folderIndex) || 0),
    page: Math.max(1, Math.floor(Number(state.page) || 1)),
    items: Array.isArray(state.items) ? [...state.items] : [],
  });
}

/**
 * @param {number} chatId
 */
export function clearTreeBrowseState(chatId) {
  const id = Number(chatId);
  if (!Number.isInteger(id)) return;
  byChatId.delete(id);
}

/**
 * @param {number} chatId
 * @returns {TreeBrowseState | null}
 */
export function getTreeBrowseState(chatId) {
  const id = Number(chatId);
  if (!Number.isInteger(id)) return null;
  const state = byChatId.get(id);
  if (!state) return null;
  return { ...state, items: [...state.items] };
}

/**
 * @param {TreeBrowseState | null | undefined} state
 * @param {number} pick 1-based index on the current page
 * @returns {TreeItem | null}
 */
export function treeBrowseItemAtPick(state, pick) {
  const n = Math.floor(Number(pick) || 0);
  if (n < 1) return null;
  const items = state?.items || [];
  return items[n - 1] || null;
}

/** Clears all in-memory state (tests). */
export function _resetTreeBrowseStateForTests() {
  byChatId.clear();
}
