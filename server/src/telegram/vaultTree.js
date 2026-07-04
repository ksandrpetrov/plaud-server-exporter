/**
 * Read-only helpers for the Telegram bot "Files" screens:
 * - buildSyncIndexTreeRoot: list folders with file counts (root navigation)
 * - buildSyncIndexFolderPage: paginate files inside one folder (drill-down)
 *
 * The tree is hierarchical: the root view is a list of folder buttons; clicking
 * a folder drills into a paginated listing of its files. Folders are addressed
 * by their 0-based index in the sorted root listing so callback_data stays
 * short and stable for the duration of a screen.
 */

export { parseSummaryFilename } from "./treeFilenameParse.js";
export {
  plaudFolderLabelFromVaultPath,
  comparePlaudFolderLabels,
} from "./treeFolderLabels.js";
export {
  MAX_TREE_ROWS,
  DEFAULT_TREE_PAGE_SIZE,
  buildSyncIndexTreeRoot,
  buildSyncIndexFolderPage,
} from "./syncIndexTree.js";

/** @typedef {import("./syncIndexTree.js").TreeItem} TreeItem */
/** @typedef {import("./syncIndexTree.js").SyncIndexTreeRoot} SyncIndexTreeRoot */
/** @typedef {import("./syncIndexTree.js").SyncIndexFolderPage} SyncIndexFolderPage */
