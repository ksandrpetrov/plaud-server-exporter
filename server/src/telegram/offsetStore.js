/**
 * Persistent Telegram long-polling offset.
 *
 * Telegram drops an update from the queue once we either confirm it via a
 * higher `offset` or 24 hours pass. To make restarts idempotent we save the
 * confirmed offset to `server/.data/telegram-offset.json` after every batch.
 *
 * Atomic write (tmp + rename, mode `0o600`).
 */

import { config } from "../config/config.js";
import { readJsonSafe, writeJsonAtomic } from "../util/atomicJson.js";

export async function loadOffset(path = config.telegramOffsetPath) {
  const parsed = await readJsonSafe(path, { label: "telegram-offset.json" });
  const value = Number(parsed?.offset);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * @param {number} offset
 * @param {string} [path]
 */
export async function saveOffset(offset, path = config.telegramOffsetPath) {
  const value = Number(offset);
  if (!Number.isFinite(value) || value < 0) return;
  const record = {
    offset: Math.floor(value),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(path, record);
}
