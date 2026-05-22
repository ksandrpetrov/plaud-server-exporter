/**
 * Single source of truth for "write a JSON file safely" in `server/.data/`.
 *
 * Eight call sites (sync-index, status, owner-chat, bot-settings, offset,
 * tree-browse, session snapshot, error reporter) used to inline the same
 * dance: `mkdir -p`, `JSON.stringify`, write to `*.tmp-<pid>-<ts>`, rename
 * over the real path, best-effort `chmod 0o600`. Drift between them was
 * already visible: `status.json` skipped the chmod, `session.json` skipped
 * the tmp+rename entirely (so a crash mid-write would corrupt the snapshot),
 * and the temp-path suffix differed enough to risk same-pid collisions.
 *
 * Centralising the pattern here lets the rest of the code state intent
 * ("persist this object") and inherit the security and durability
 * guarantees mandated by `docs/security.md` (mode 0o600, atomic rename).
 */

import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
 * missing, writes to a unique temp file, then renames over `path`. Sets mode
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
  await mkdir(dirname(path), { recursive: true });

  const payload = `${JSON.stringify(value, null, indent)}\n`;
  const tmp = tempPathFor(path);
  await writeFile(tmp, payload, "utf8");
  await rename(tmp, path);

  if (mode != null) {
    try {
      await chmod(path, mode);
    } catch {
      // chmod is best-effort: Windows + some FUSE mounts refuse it and the
      // file is still in place with whatever umask gave us.
    }
  }
}
