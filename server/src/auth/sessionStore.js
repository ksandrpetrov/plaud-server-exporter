import { mkdir, readFile, chmod, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config/config.js";
import { writeJsonAtomic } from "../util/atomicJson.js";

const SNAPSHOT_VERSION = 1;

/**
 * Session snapshot persisted to disk. Layout intentionally mirrors what
 * Plaud Web stores in `localStorage` so that the server-side extractor can
 * reuse the same key logic as the extension. Values are kept verbatim because
 * we need them for the Authorization header.
 *
 * @typedef {{
 *   version: number;
 *   savedAt: string;
 *   apiBase?: string;
 *   localStorage: Record<string, string>;
 *   cookies?: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number }>;
 * }} SessionSnapshot
 */

export async function ensureSecureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  try {
    await chmod(dirPath, 0o700);
  } catch {
    // chmod can fail on Windows / some FS; non-fatal.
  }
}

/**
 * @param {SessionSnapshot} snapshot
 */
export async function saveSessionSnapshot(snapshot) {
  const payload = {
    ...snapshot,
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
  };
  // The session lives in `server/.data/` which the helper already chmods to
  // 0o700, but a fresh PLAUD_DATA_DIR may have looser permissions; tightening
  // the directory before the write matches the sync-index path exactly.
  await ensureSecureDir(dirname(config.sessionPath));
  await writeJsonAtomic(config.sessionPath, payload);
}

/**
 * @returns {Promise<SessionSnapshot | null>}
 */
export async function loadSessionSnapshot() {
  try {
    const text = await readFile(config.sessionPath, "utf8");
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || !data.localStorage) return null;
    return data;
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function sessionFileInfo() {
  try {
    const s = await stat(config.sessionPath);
    return { exists: true, size: s.size, mtime: s.mtime.toISOString() };
  } catch (err) {
    if (err && err.code === "ENOENT") return { exists: false };
    throw err;
  }
}

export async function removeSessionSnapshot() {
  try {
    await unlink(config.sessionPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}
