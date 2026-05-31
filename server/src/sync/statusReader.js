/**
 * Read-only helper around `server/.data/status.json`. The file is written by
 * `runSync` after every (real, not dry-run) sync; CLI and the bot read it for
 * status screens, menu headers, and the scheduler's "is it time yet?" decision.
 */

import { config } from "../config/config.js";
import { readJsonSafe } from "../util/atomicJson.js";
import { normalizeLastAuthError } from "./statusSchema.js";

/**
 * @typedef {{
 *   lastSyncAt: string | null;
 *   lastSyncStats: object | null;
 *   lastAuthError: { message: string; at: string } | null;
 *   updatedAt: string;
 * }} StatusPayload
 */

/**
 * @param {string} [path]
 * @returns {Promise<StatusPayload | null>}
 */
export async function readStatus(path = config.statusPath) {
  const parsed = await readJsonSafe(path, { label: "status.json" });
  if (!parsed || typeof parsed !== "object") return null;
  if (!("lastAuthError" in parsed)) return { ...parsed };
  return {
    ...parsed,
    lastAuthError: normalizeLastAuthError(parsed.lastAuthError),
  };
}
