/**
 * Read-only vault filesystem scan (summary .md counts for Telegram Files menu).
 * Writers stay in sync/; telegram handlers import from here or via vaultTree re-export.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { logger } from "../logger.js";

export const MAX_VAULT_DEPTH = 4;
export const MAX_VAULT_FILES_SCANNED = 5000;
export const MAX_RECENT_FILES = 10;

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
      logger.warn("vaultDiskScan: readdir failed", {
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
        logger.warn("vaultDiskScan: stat failed", {
          path: abs,
          error: String(err?.message || err),
        });
      }
    }
  }

  try {
    await walk(startDir, 0);
  } catch (err) {
    logger.warn("vaultDiskScan: scan failed", {
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
