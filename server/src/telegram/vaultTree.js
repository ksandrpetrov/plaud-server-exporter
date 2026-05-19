/**
 * Read-only helpers for the Telegram bot "Files" screens:
 * - buildSyncIndexTree: group sync-index records by year (no I/O)
 * - scanVaultSummary: walk the export vault and count .md files
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { logger } from "../logger.js";

export const MAX_TREE_ROWS = 30;
export const MAX_VAULT_DEPTH = 4;
export const MAX_VAULT_FILES_SCANNED = 5000;
export const MAX_RECENT_FILES = 10;

const DATED_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\.md$/i;

/**
 * @typedef {{
 *   date: string;
 *   title: string;
 *   status: string;
 *   lastSyncedAt: string;
 * }} TreeItem
 */

/**
 * @typedef {{
 *   year: string;
 *   count: number;
 *   items: TreeItem[];
 *   hiddenInGroup: number;
 * }} TreeGroup
 */

/**
 * @typedef {{
 *   total: number;
 *   groups: TreeGroup[];
 *   truncated: boolean;
 * }} SyncIndexTree
 */

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
function yearFromIso(isoLike) {
  if (!isoLike) return "";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return "";
  return String(d.getUTCFullYear());
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
 * @param {object} record
 * @returns {TreeItem | null}
 */
function recordToTreeItem(record) {
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
  return { date, title, status, lastSyncedAt };
}

/**
 * @param {object | null | undefined} syncIndex
 * @param {{ maxRows?: number }} [options]
 * @returns {SyncIndexTree}
 */
export function buildSyncIndexTree(syncIndex, options = {}) {
  const maxRows = options.maxRows ?? MAX_TREE_ROWS;
  const records = syncIndex?.records;
  if (!records || typeof records !== "object") {
    return { total: 0, groups: [], truncated: false };
  }

  /** @type {TreeItem[]} */
  const items = [];
  for (const record of Object.values(records)) {
    const item = recordToTreeItem(record);
    if (item) items.push(item);
  }

  items.sort((a, b) => {
    const ta = Date.parse(a.lastSyncedAt) || 0;
    const tb = Date.parse(b.lastSyncedAt) || 0;
    return tb - ta;
  });

  const total = items.length;
  const truncated = total > maxRows;
  const visible = truncated ? items.slice(0, maxRows) : items;

  /** @type {Map<string, TreeItem[]>} */
  const byYear = new Map();
  for (const item of visible) {
    const parsed = parseSummaryFilename(`${item.date} - ${item.title}.md`);
    const year =
      parsed?.year ||
      (item.date.startsWith("—") ? "" : item.date.slice(0, 4)) ||
      yearFromIso(item.lastSyncedAt) ||
      "—";
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(item);
  }

  const groups = [...byYear.entries()]
    .sort(([a], [b]) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return b.localeCompare(a);
    })
    .map(([year, groupItems]) => ({
      year,
      count: groupItems.length,
      items: groupItems,
      hiddenInGroup: 0,
    }));

  return { total, groups, truncated };
}

/**
 * @typedef {{
 *   exists: boolean;
 *   subfolder: string;
 *   totalCount: number;
 *   totalBytes: number;
 *   lastMtime: string | null;
 *   recent: Array<{ relativePath: string; size: number; mtime: string }>;
 *   scanTruncated: boolean;
 * }} VaultSummary
 */

/**
 * @param {{
 *   vaultRoot: string;
 *   subfolder?: string;
 *   maxDepth?: number;
 *   maxFiles?: number;
 *   recentLimit?: number;
 * }} params
 * @returns {Promise<VaultSummary>}
 */
export async function scanVaultSummary(params) {
  const vaultRoot = String(params.vaultRoot || "");
  const subfolder = String(params.subfolder || "Plaud").trim() || "Plaud";
  const maxDepth = params.maxDepth ?? MAX_VAULT_DEPTH;
  const maxFiles = params.maxFiles ?? MAX_VAULT_FILES_SCANNED;
  const recentLimit = params.recentLimit ?? MAX_RECENT_FILES;

  const empty = {
    exists: false,
    subfolder,
    totalCount: 0,
    totalBytes: 0,
    lastMtime: null,
    recent: [],
    scanTruncated: false,
  };

  if (!vaultRoot) return empty;

  const startDir = join(vaultRoot, subfolder);

  /** @type {Array<{ relativePath: string; size: number; mtime: string; mtimeMs: number }>} */
  const allMd = [];
  let scanTruncated = false;

  /**
   * @param {string} dir
   * @param {number} depth
   */
  async function walk(dir, depth) {
    if (depth > maxDepth || allMd.length >= maxFiles) {
      if (allMd.length >= maxFiles) scanTruncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT" && depth === 0) return;
      logger.warn("vaultTree: readdir failed", {
        dir,
        error: String(err?.message || err),
      });
      return;
    }

    for (const entry of entries) {
      if (allMd.length >= maxFiles) {
        scanTruncated = true;
        return;
      }
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_attachments" || entry.name.startsWith(".")) continue;
        await walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      try {
        const s = await stat(abs);
        const rel = relative(vaultRoot, abs).replace(/\\/g, "/");
        allMd.push({
          relativePath: rel,
          size: s.size,
          mtime: s.mtime.toISOString(),
          mtimeMs: s.mtimeMs,
        });
      } catch (err) {
        logger.warn("vaultTree: stat failed", {
          path: abs,
          error: String(err?.message || err),
        });
      }
    }
  }

  try {
    await walk(startDir, 0);
  } catch (err) {
    logger.warn("vaultTree: scan failed", {
      error: String(err?.message || err),
    });
    return empty;
  }

  if (allMd.length === 0) {
    try {
      await stat(startDir);
    } catch (err) {
      if (err && err.code === "ENOENT") return empty;
    }
    return {
      exists: true,
      subfolder,
      totalCount: 0,
      totalBytes: 0,
      lastMtime: null,
      recent: [],
      scanTruncated,
    };
  }

  let totalBytes = 0;
  let lastMtimeMs = 0;
  let lastMtime = null;
  for (const f of allMd) {
    totalBytes += f.size;
    if (f.mtimeMs > lastMtimeMs) {
      lastMtimeMs = f.mtimeMs;
      lastMtime = f.mtime;
    }
  }

  const recent = [...allMd]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, recentLimit)
    .map(({ relativePath, size, mtime }) => ({ relativePath, size, mtime }));

  return {
    exists: true,
    subfolder,
    totalCount: allMd.length,
    totalBytes,
    lastMtime,
    recent,
    scanTruncated,
  };
}
