import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { config } from "../config/config.js";
import {
  createEmptySyncIndex,
  normalizeSyncIndex,
} from "../../../browser-extension/common/syncCore.js";
import { writeJsonAtomic } from "../util/atomicJson.js";

export async function loadSyncIndex(path = config.syncIndexPath) {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    return normalizeSyncIndex(parsed);
  } catch (err) {
    if (err && err.code === "ENOENT") return createEmptySyncIndex();
    if (err instanceof SyntaxError) {
      const backupPath = `${path}.bak`;
      try {
        const backupText = await readFile(backupPath, "utf8");
        const parsed = JSON.parse(backupText);
        return normalizeSyncIndex(parsed);
      } catch {
        return createEmptySyncIndex();
      }
    }
    throw err;
  }
}

export async function saveSyncIndex(syncIndex, path = config.syncIndexPath) {
  const normalized = normalizeSyncIndex(syncIndex || createEmptySyncIndex());
  normalized.updatedAt = new Date().toISOString();

  // Rotate the previous index to .bak before overwriting: corrupted writes
  // (e.g. ENOSPC mid-rename) can then be recovered by `loadSyncIndex`.
  await rotateSyncIndexBackup(path);
  await writeJsonAtomic(path, normalized);
  return normalized;
}

async function rotateSyncIndexBackup(path) {
  const backupPath = `${path}.bak`;
  try {
    await stat(path);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  const existing = await readFile(path, "utf8");
  const backupTmp = `${backupPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(backupTmp, existing, "utf8");
  await rename(backupTmp, backupPath);
}

export async function syncIndexInfo(path = config.syncIndexPath) {
  try {
    const s = await stat(path);
    const index = await loadSyncIndex(path);
    return {
      exists: true,
      size: s.size,
      mtime: s.mtime.toISOString(),
      recordCount: Object.keys(index.records || {}).length,
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return { exists: false, recordCount: 0 };
    throw err;
  }
}
