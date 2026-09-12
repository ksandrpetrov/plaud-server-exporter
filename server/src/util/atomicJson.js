/**
 * Single source of truth for safe JSON I/O in `server/.data/`.
 *
 * Write side: eight call sites (sync-index, status, owner-chat, bot-settings,
 * offset, tree-browse, session snapshot, error reporter) used to inline the
 * same dance: `mkdir -p`, `JSON.stringify`, write to `*.tmp-<pid>-<ts>`,
 * rename over the real path, best-effort `chmod 0o600`. Drift between them was
 * already visible: `status.json` skipped the chmod, `session.json` skipped
 * the tmp+rename entirely (so a crash mid-write would corrupt the snapshot),
 * and the temp-path suffix differed enough to risk same-pid collisions.
 *
 * Read side: the matching readers all repeated `readFile` → `JSON.parse` →
 * `if (err.code === "ENOENT") return <default>` → `logger.warn` → return the
 * default. `readJsonSafe` captures that "missing or corrupt file is not fatal"
 * policy in one place; callers keep their own post-parse validation.
 *
 * Centralising the pattern here lets the rest of the code state intent
 * ("persist this object" / "read it back, tolerating absence") and inherit the
 * security and durability guarantees mandated by `docs/security.md`
 * (mode 0o600, atomic rename).
 */

import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "../logger.js";

/**
 * @param {string} path absolute path
 * @returns {string}
 */
function tempPathFor(path) {
  return `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Atomically write a JSON file at `path`. Creates the parent directory if
 * missing, creates a private temp file, then renames over `path`. Reapplies
 * `0o600` afterwards (`docs/security.md`); pass `mode: null` to skip the
 * chmod for files that intentionally need a different mode.
 *
 * @param {string} path absolute path
 * @param {unknown} value JSON-serialisable value
 * @param {{ mode?: number | null; indent?: number }} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(path, value, options = {}) {
  const { mode = 0o600, indent = 2 } = options;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const payload = `${JSON.stringify(value, null, indent)}\n`;
  const tmp = tempPathFor(path);
  try {
    await writeFile(tmp, payload, {
      encoding: "utf8",
      mode: mode ?? undefined,
      flag: "wx",
    });
    await rename(tmp, path);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      await rm(tmp, { force: true }).catch((cleanupError) => {
        logger.warn("Failed to clean temporary JSON file", {
          error: String(cleanupError?.message || cleanupError),
        });
      });
    }
    throw error;
  }

  if (mode != null) {
    try {
      await chmod(path, mode);
    } catch {
      // chmod is best-effort: Windows + some FUSE mounts refuse it and the
      // file still has its creation mode, possibly restricted further by umask.
    }
  }
}

/**
 * Read and JSON-parse a file, tolerating absence and corruption.
 *
 * A missing file (`ENOENT`) returns `fallback` silently — that is the normal
 * "first run" case. Any other failure (unreadable, malformed JSON) returns
 * `fallback` too, but logs a warning tagged with `label` so corruption stays
 * visible. Callers remain responsible for validating/normalising the parsed
 * shape, since each `.data/*.json` file has its own schema.
 *
 * @template [T=any]
 * @param {string} path absolute path
 * @param {{ fallback?: T | null; label?: string }} [options]
 * @returns {Promise<T | null>}
 */
export async function readJsonSafe(path, { fallback = null, label } = {}) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === "ENOENT") {
      return fallback;
    }
    logger.warn(`Failed to read ${label || path}`, {
      error: String(/** @type {{ message?: string }} */ (err)?.message || err),
    });
    return fallback;
  }
}
