/**
 * Single-host file lock for the sync process.
 *
 * Plaud sync writes Markdown files, the sync-index, and `_errors/` reports.
 * Two parallel runs (e.g. a cron run + a manual run) racing for the same
 * sync-index could corrupt it or fight over file renames. We use a tiny
 * atomic lock based on `open(O_EXCL)` so we do not need a database.
 *
 * Locks are stored as `{config.dataDir}/sync.lock` and contain a JSON
 * payload `{ pid, host, startedAt }`. A lock is considered stale if its
 * owning PID is dead (signal 0 throws ESRCH) or it has been held longer
 * than `STALE_LOCK_MAX_AGE_MS`.
 */
import { mkdir, readFile, unlink, stat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { config } from "../config/config.js";

const LOCK_FILENAME = "sync.lock";
/**
 * 2 hours. The longest realistic sync (large vaults + slow Plaud responses)
 * is still ≤ a few minutes; anything older means the previous process died
 * without releasing.
 */
const STALE_LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function lockPath() {
  return join(config.dataDir, LOCK_FILENAME);
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

async function readLockInfo(path) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function isStaleLock(path) {
  let info;
  try {
    info = await readLockInfo(path);
  } catch {
    info = null;
  }
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    return true;
  }
  if (Date.now() - mtimeMs > STALE_LOCK_MAX_AGE_MS) return true;
  if (info && Number.isInteger(info.pid)) {
    if (info.host && info.host !== hostname()) return false;
    return !pidIsAlive(info.pid);
  }
  return false;
}

export class SyncLockError extends Error {
  constructor(message, info) {
    super(message);
    this.name = "SyncLockError";
    this.lockInfo = info || null;
  }
}

/**
 * Acquire the sync lock. Returns a `release()` function. Throws
 * `SyncLockError` if another process holds the lock.
 *
 * @returns {Promise<() => Promise<void>>}
 */
export async function acquireSyncLock() {
  await mkdir(dirname(lockPath()), { recursive: true });
  const path = lockPath();
  const payload = JSON.stringify({
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(payload, "utf8");
      } finally {
        await handle.close();
      }
      return () => releaseSyncLock(path);
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      if (await isStaleLock(path)) {
        try {
          await unlink(path);
        } catch (unlinkErr) {
          if (unlinkErr?.code !== "ENOENT") throw unlinkErr;
        }
        continue;
      }
      const info = await readLockInfo(path);
      throw new SyncLockError(
        `Another plaud-server-exporter run already holds the sync lock (${path}).`,
        info
      );
    }
  }
  const info = await readLockInfo(path);
  throw new SyncLockError(
    `Could not acquire sync lock after retry: ${path}`,
    info
  );
}

async function releaseSyncLock(path) {
  try {
    const info = await readLockInfo(path);
    if (info && info.pid && info.pid !== process.pid) {
      return;
    }
    await unlink(path);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

export function syncLockPath() {
  return lockPath();
}
