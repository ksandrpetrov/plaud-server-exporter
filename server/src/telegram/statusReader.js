/**
 * Read-only helper around `server/.data/status.json`. The file is written by
 * `runSync` after every (real, not dry-run) sync; the bot reads it for the
 * status screen, menu header, and the scheduler's "is it time yet?" decision.
 */

import { readFile } from "node:fs/promises";
import { config } from "../config/config.js";
import { logger } from "../logger.js";

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
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    logger.warn("Failed to read status.json", {
      error: String(err?.message || err),
    });
    return null;
  }
}
