/**
 * Read-only sync-index API for Telegram tree UI.
 *
 * Writers (`syncRunner`, `serverSyncIndex.saveSyncIndex`) stay in sync/;
 * bot handlers import from here instead of touching index file paths directly.
 */

import { loadSyncIndex } from "./serverSyncIndex.js";

/**
 * @param {string} [path]
 * @returns {Promise<import("../../../plaud-exporter/common/syncCore.js").SyncIndex>}
 */
export async function loadIndexForBot(path) {
  return loadSyncIndex(path);
}

/**
 * @param {object | null | undefined} syncIndex
 * @returns {Array<{ stableId: string } & Record<string, unknown>>}
 */
export function getIndexedRecords(syncIndex) {
  const records = syncIndex?.records;
  if (!records || typeof records !== "object") return [];
  return Object.entries(records).map(([stableId, record]) => ({
    stableId,
    ...(record && typeof record === "object" ? record : {}),
  }));
}

/**
 * @param {object | null | undefined} syncIndex
 * @param {string} stableId
 * @returns {Record<string, unknown> | null}
 */
export function getRecordByStableId(syncIndex, stableId) {
  const id = String(stableId || "").trim();
  if (!id) return null;
  const record = syncIndex?.records?.[id];
  if (!record || typeof record !== "object") return null;
  return record;
}
