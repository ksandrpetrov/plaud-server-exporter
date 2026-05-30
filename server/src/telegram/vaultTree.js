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

import { basename, dirname, relative } from "node:path";
import {
  PLAUD_FOLDER_TRASH,
  PLAUD_FOLDER_UNFILED,
} from "../plaud/plaudFolders.js";

export {
  MAX_RECENT_FILES,
  MAX_VAULT_DEPTH,
  MAX_VAULT_FILES_SCANNED,
  scanVaultSummary,
} from "../sync/vaultDiskScan.js";

export const MAX_TREE_ROWS = 30;

const DATED_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\.md$/i;
const YEAR_ONLY_SEGMENT_RE = /^\d{4}$/;

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

export const DEFAULT_TREE_PAGE_SIZE = MAX_TREE_ROWS;

/**
 * @param {string} pathOrName
 * @returns {{ date: string; title: string; year: string } | null}
 */
export function parseSummaryFilename(pathOrName) {
  const name = basename(String(pathOrName || ""));
  const match = DATED_FILENAME_RE.exec(name);
  if (!match) return null;
  const date = match[1];
  const title = match[2].trim() || name;
  return { date, title, year: date.slice(0, 4) };
}

/**
 * @param {string} isoLike
 * @returns {string}
 */
function dateFromIso(isoLike) {
  if (!isoLike) return "";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Display label for a Plaud folder group (user folder, Unfiled, or Trash).
 *
 * @param {string} vaultRelativeDir e.g. `Plaud/SocServ QA` or `Plaud/2026`
 * @param {string} subfolder e.g. `Plaud`
 * @returns {string}
 */
export function plaudFolderLabelFromVaultPath(vaultRelativeDir, subfolder) {
  const sub = String(subfolder || "Plaud").replace(/\\/g, "/");
  let dir = String(vaultRelativeDir || "")
    .replace(/\\/g, "/")
    .trim();

  if (!dir || dir === sub) return PLAUD_FOLDER_UNFILED;
  if (dir.startsWith(`${sub}/`)) dir = dir.slice(sub.length + 1);

  const parts = dir.split("/").filter(Boolean);
  if (!parts.length) return PLAUD_FOLDER_UNFILED;

  if (parts.length === 1 && YEAR_ONLY_SEGMENT_RE.test(parts[0])) {
    return PLAUD_FOLDER_UNFILED;
  }
  if (parts.length > 1 && YEAR_ONLY_SEGMENT_RE.test(parts[0])) {
    return parts.slice(1).join("/") || PLAUD_FOLDER_UNFILED;
  }

  return dir;
}

/**
 * @param {object} record
 * @param {{ vaultRoot?: string; subfolder?: string }} ctx
 * @returns {string}
 */
function folderLabelFromRecord(record, ctx) {
  const stored = String(record?.folderSegment || "").trim();
  if (stored) return stored;

  const subfolder = String(ctx.subfolder || "Plaud").replace(/\\/g, "/");
  const summaryPath = String(record?.summaryPath || "");
  const vaultRoot = String(ctx.vaultRoot || "");

  if (summaryPath && vaultRoot) {
    const rel = relative(vaultRoot, summaryPath).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && rel !== ".") {
      const dir = dirname(rel);
      if (dir && dir !== ".") {
        return plaudFolderLabelFromVaultPath(dir, subfolder);
      }
      return PLAUD_FOLDER_UNFILED;
    }
  }

  return PLAUD_FOLDER_UNFILED;
}

/**
 * Sort: user folders A–Z, then Unfiled, then Trash.
 *
 * @param {string} a
 * @param {string} b
 */
export function comparePlaudFolderLabels(a, b) {
  const rank = (label) => {
    if (label === PLAUD_FOLDER_UNFILED) return 1;
    if (label === PLAUD_FOLDER_TRASH) return 2;
    return 0;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

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
 * Iterate sync-index records once, bucketing items by folder label and sorting
 * each bucket by `lastSyncedAt` descending. Items missing/invalid records are
 * silently dropped. Empty index → empty map.
 *
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
 * Stable folder ordering used everywhere the tree is rendered (user folders
 * A–Z, then Unfiled, then Trash). The same comparator is exposed for tests.
 *
 * @param {Map<string, unknown>} byFolder
 * @returns {string[]}
 */
function sortedFolderLabels(byFolder) {
  return [...byFolder.keys()].sort(comparePlaudFolderLabels);
}

/**
 * Root view of the tree: a list of folder labels with file counts, in the
 * canonical sort order. Used to render the folder-list screen and to resolve
 * `folderIndex` → folder label for drill-down navigation.
 *
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
 * Paginated drill-down view into a single folder. The folder can be addressed
 * either by its label (`folder`) or by its 0-based index in the canonical
 * sorted folder list (`folderIndex`); the index form is what navigation
 * callbacks use so payloads fit comfortably in Telegram's 64-byte limit.
 *
 * Returns `exists: false` (with an empty `items` slice) when the requested
 * folder isn't found — callers should fall back to the root view in that case.
 *
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
