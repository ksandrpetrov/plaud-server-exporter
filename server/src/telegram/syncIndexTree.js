import { basename } from "node:path";
import { PLAUD_FOLDER_UNFILED } from "../plaud/plaudFolders.js";
import { dateFromIso, parseSummaryFilename } from "./treeFilenameParse.js";
import {
  comparePlaudFolderLabels,
  folderLabelFromRecord,
} from "./treeFolderLabels.js";

export const MAX_TREE_ROWS = 30;
export const DEFAULT_TREE_PAGE_SIZE = MAX_TREE_ROWS;

/**
 * @typedef {{
 *   date: string;
 *   title: string;
 *   status: string;
 *   lastSyncedAt: string;
 *   folder: string;
 *   stableId: string;
 *   summaryPath: string;
 * }} TreeItem
 */

/**
 * @typedef {{ folder: string; count: number }} TreeFolderSummary
 */

/**
 * @typedef {{
 *   total: number;
 *   folders: TreeFolderSummary[];
 * }} SyncIndexTreeRoot
 */

/**
 * @typedef {{
 *   folder: string;
 *   folderIndex: number;
 *   exists: boolean;
 *   total: number;
 *   items: TreeItem[];
 *   page: number;
 *   pageSize: number;
 *   totalPages: number;
 * }} SyncIndexFolderPage
 */

/**
 * @param {object} record
 * @param {{ vaultRoot?: string; subfolder?: string }} ctx
 * @returns {TreeItem | null}
 */
function recordToTreeItem(record, ctx) {
  if (!record || typeof record !== "object") return null;
  const pathHint = record.summaryPath || record.normalizedFilename || "";
  const parsed = parseSummaryFilename(pathHint);
  const lastSyncedAt = String(record.lastSyncedAt || "");
  const date = parsed?.date || dateFromIso(lastSyncedAt) || "—";
  const title =
    String(record.title || "").trim() ||
    parsed?.title ||
    basename(pathHint) ||
    "Без названия";
  const status = String(record.status || "");
  const folder = folderLabelFromRecord(record, ctx);
  return {
    date,
    title,
    status,
    lastSyncedAt,
    folder,
    stableId: String(record.stableId || ""),
    summaryPath: String(record.summaryPath || ""),
  };
}

/**
 * @param {object | null | undefined} syncIndex
 * @param {{ vaultRoot?: string; subfolder?: string }} ctx
 * @returns {Map<string, TreeItem[]>}
 */
function collectItemsByFolder(syncIndex, ctx) {
  /** @type {Map<string, TreeItem[]>} */
  const byFolder = new Map();
  const records = syncIndex?.records;
  if (!records || typeof records !== "object") return byFolder;

  for (const record of Object.values(records)) {
    const item = recordToTreeItem(record, ctx);
    if (!item) continue;
    const label = item.folder || PLAUD_FOLDER_UNFILED;
    if (!byFolder.has(label)) byFolder.set(label, []);
    byFolder.get(label).push(item);
  }

  for (const items of byFolder.values()) {
    items.sort((a, b) => {
      const ta = Date.parse(a.lastSyncedAt) || 0;
      const tb = Date.parse(b.lastSyncedAt) || 0;
      return tb - ta;
    });
  }

  return byFolder;
}

/**
 * @param {Map<string, unknown>} byFolder
 * @returns {string[]}
 */
function sortedFolderLabels(byFolder) {
  return [...byFolder.keys()].sort(comparePlaudFolderLabels);
}

/**
 * @param {object | null | undefined} syncIndex
 * @param {{ vaultRoot?: string; subfolder?: string }} [options]
 * @returns {SyncIndexTreeRoot}
 */
export function buildSyncIndexTreeRoot(syncIndex, options = {}) {
  const ctx = {
    vaultRoot: options.vaultRoot || "",
    subfolder: options.subfolder || "Plaud",
  };
  const byFolder = collectItemsByFolder(syncIndex, ctx);
  const labels = sortedFolderLabels(byFolder);
  const folders = labels.map((folder) => ({
    folder,
    count: byFolder.get(folder).length,
  }));
  const total = folders.reduce((n, g) => n + g.count, 0);
  return { total, folders };
}

/**
 * @param {object | null | undefined} syncIndex
 * @param {{
 *   folder?: string;
 *   folderIndex?: number;
 *   page?: number;
 *   pageSize?: number;
 *   vaultRoot?: string;
 *   subfolder?: string;
 * }} [options]
 * @returns {SyncIndexFolderPage}
 */
export function buildSyncIndexFolderPage(syncIndex, options = {}) {
  const ctx = {
    vaultRoot: options.vaultRoot || "",
    subfolder: options.subfolder || "Plaud",
  };
  const rawPageSize = options.pageSize ?? DEFAULT_TREE_PAGE_SIZE;
  const pageSize = Math.max(
    1,
    Math.floor(Number(rawPageSize) || DEFAULT_TREE_PAGE_SIZE)
  );

  const byFolder = collectItemsByFolder(syncIndex, ctx);
  const labels = sortedFolderLabels(byFolder);

  let folderName = String(options.folder || "");
  let folderIndex = Number.isFinite(options.folderIndex)
    ? Math.floor(Number(options.folderIndex))
    : -1;

  if (folderName) {
    folderIndex = labels.indexOf(folderName);
  } else if (folderIndex >= 0 && folderIndex < labels.length) {
    folderName = labels[folderIndex];
  }

  if (!folderName || folderIndex < 0 || folderIndex >= labels.length) {
    return {
      folder: folderName,
      folderIndex: -1,
      exists: false,
      total: 0,
      items: [],
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }

  const items = byFolder.get(folderName) || [];
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number.isFinite(options.page)
    ? Math.floor(Number(options.page))
    : 1;
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const startIdx = (page - 1) * pageSize;
  const pageItems = items.slice(startIdx, startIdx + pageSize);

  return {
    folder: folderName,
    folderIndex,
    exists: total > 0,
    total,
    items: pageItems,
    page,
    pageSize,
    totalPages,
  };
}
