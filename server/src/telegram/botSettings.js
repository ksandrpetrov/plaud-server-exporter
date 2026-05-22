/**
 * Persistent bot settings (scheduler interval + scheduled-sync chat visibility).
 *
 * Stored at `server/.data/bot-settings.json`. On first run the file does not
 * exist and we fall back to `config.botSyncIntervalMin` from `.env` for the
 * interval, and to `DEFAULT_SCHEDULED_SUMMARY_VISIBLE` for the visibility
 * toggle. The user can change either value via `/settings` in the bot; we
 * persist the whole record so values survive restarts.
 *
 * Writes are atomic (tmp + rename, mode `0o600`), like `serverSyncIndex.js`.
 * Partial updates (e.g. toggling only the visibility flag) are merged with
 * whatever the file already holds — callers never have to read-modify-write.
 */

import { readFile } from "node:fs/promises";
import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { writeJsonAtomic } from "../util/atomicJson.js";

/**
 * Allowed values for the scheduler interval (minutes). The bot's settings
 * keyboard and `isAllowedInterval` are both driven by this single list, so
 * adding a preset is a one-line change.
 */
export const INTERVAL_PRESETS_MIN = [60, 120, 240, 480];

/**
 * Default visibility for scheduled-sync chat updates.
 *
 * `false` means the auto-sync runs silently (only logs); the user can opt in
 * via the settings toggle to receive the "🕒 Автозапуск синка…" summary in
 * chat. Manual `/sync` taps are always loud regardless of this flag.
 */
export const DEFAULT_SCHEDULED_SUMMARY_VISIBLE = false;

/**
 * @typedef {{
 *   intervalMin: number;
 *   scheduledSummaryVisible: boolean;
 *   updatedAt: string;
 * }} BotSettings
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
      scheduledSummaryVisible: parseBoolField(
        parsed?.scheduledSummaryVisible,
        DEFAULT_SCHEDULED_SUMMARY_VISIBLE
      ),
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
 * Atomic write with partial-update semantics: any field absent from `input`
 * is preserved from the on-disk record (or the default when no record exists).
 *
 * @param {{ intervalMin?: number; scheduledSummaryVisible?: boolean }} [input]
 * @param {string} [path]
 * @returns {Promise<BotSettings>}
 */
export async function saveBotSettings(input = {}, path = config.botSettingsPath) {
  const existing = await loadBotSettings(path);

  const intervalCandidate =
    input?.intervalMin !== undefined
      ? Number(input.intervalMin)
      : existing?.intervalMin ?? config.botSyncIntervalMin;
  if (!Number.isFinite(intervalCandidate) || intervalCandidate <= 0) {
    throw new Error("saveBotSettings: intervalMin must be a positive integer");
  }

  const summaryVisible =
    input?.scheduledSummaryVisible !== undefined
      ? Boolean(input.scheduledSummaryVisible)
      : existing?.scheduledSummaryVisible ?? DEFAULT_SCHEDULED_SUMMARY_VISIBLE;

  const record = {
    intervalMin: Math.floor(intervalCandidate),
    scheduledSummaryVisible: summaryVisible,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(path, record);
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
 * Returns the effective visibility of scheduled-sync chat messages.
 * Silent by default; flipping the toggle in `/settings` flips this.
 *
 * @returns {Promise<boolean>}
 */
export async function loadEffectiveScheduledSummaryVisible() {
  const persisted = await loadBotSettings();
  if (persisted) return persisted.scheduledSummaryVisible;
  return DEFAULT_SCHEDULED_SUMMARY_VISIBLE;
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

/**
 * Forgiving boolean parse for JSON values written by humans or legacy records
 * without the field. Anything missing / null / undefined falls back to
 * `fallback`; explicit `false`/`true` and the usual string variants pass
 * through.
 *
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBoolField(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lower)) return true;
    if (["false", "0", "no", "off"].includes(lower)) return false;
  }
  return fallback;
}
