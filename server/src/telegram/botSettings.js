/**
 * Persistent bot settings (currently only the scheduler interval).
 *
 * Stored at `server/.data/bot-settings.json`. On first run the file does not
 * exist and we fall back to `config.botSyncIntervalMin` from `.env`. The user
 * can change the interval via `/settings` in the bot; we then persist it so
 * the value survives restarts.
 *
 * Writes are atomic (tmp + rename, mode `0o600`), like `serverSyncIndex.js`.
 */

import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { INTERVAL_PRESETS_MIN } from "./messages.js";

/**
 * @typedef {{ intervalMin: number; updatedAt: string }} BotSettings
 */

/**
 * @param {string} [path]
 * @returns {Promise<BotSettings | null>}
 */
export async function loadBotSettings(path = config.botSettingsPath) {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    const interval = Number(parsed?.intervalMin);
    if (!Number.isFinite(interval) || interval <= 0) return null;
    return {
      intervalMin: Math.floor(interval),
      updatedAt: String(parsed?.updatedAt || ""),
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    logger.warn("Failed to read bot-settings.json", {
      error: String(err?.message || err),
    });
    return null;
  }
}

/**
 * Atomic write.
 *
 * @param {{ intervalMin: number }} input
 * @param {string} [path]
 * @returns {Promise<BotSettings>}
 */
export async function saveBotSettings(input, path = config.botSettingsPath) {
  const interval = Number(input?.intervalMin);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("saveBotSettings: intervalMin must be a positive integer");
  }
  const record = {
    intervalMin: Math.floor(interval),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, payload, "utf8");
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {
    // best-effort
  }
  return record;
}

/**
 * Returns the effective interval: persisted value if present, otherwise
 * the value from `.env` (config.botSyncIntervalMin).
 *
 * @returns {Promise<number>}
 */
export async function loadEffectiveIntervalMin() {
  const persisted = await loadBotSettings();
  if (persisted) return persisted.intervalMin;
  return config.botSyncIntervalMin;
}

/**
 * Validates that the new interval is one of the offered presets so the
 * bot never persists a free-text value that could pin sync to e.g. 1 minute.
 *
 * @param {number} intervalMin
 */
export function isAllowedInterval(intervalMin) {
  return INTERVAL_PRESETS_MIN.includes(Number(intervalMin));
}
