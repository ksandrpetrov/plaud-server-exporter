import { mkdir, readFile, writeFile, chmod, stat, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config/config.js";
import {
  createEmptySyncIndex,
  normalizeSyncIndex,
} from "../../../plaud-exporter/common/syncCore.js";

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

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
  await ensureDir(path);

  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const backupPath = `${path}.bak`;

  try {
    await stat(path);
    const existing = await readFile(path, "utf8");
    const backupTmp = `${backupPath}.tmp-${process.pid}`;
    await writeFile(backupTmp, existing, "utf8");
    await rename(backupTmp, backupPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }

  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, path);

  try {
    await chmod(path, 0o600);
  } catch {
    // non-fatal on Windows
  }
  return normalized;
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
