/**
 * Tree browse orchestration without Telegram I/O.
 */

import { access } from "node:fs/promises";
import { logger } from "../logger.js";
import { getRecordByStableId, loadIndexForBot } from "../sync/syncIndexRead.js";
import { loadPlaudLiveSyncTree } from "../plaud/liveTreeReadModel.js";

/**
 * Returns a sync-index-shaped object to feed the tree builders. Prefers a
 * live Plaud snapshot and falls back to the on-disk sync-index.
 *
 * @param {{
 *   sessionLoader: () => Promise<import("../auth/plaudSessionExtractor.js").PlaudSession | null>;
 *   loadIndex?: () => Promise<Record<string, any>>;
 *   loadLive?: (args: Record<string, any>) => Promise<Record<string, any> | null>;
 * }} params
 */
export async function loadTreeSource({
  sessionLoader,
  loadIndex = loadIndexForBot,
  loadLive = loadPlaudLiveSyncTree,
}) {
  const real = await loadIndex();
  try {
    const live = await loadLive({ syncIndex: real, sessionLoader });
    if (live && Object.keys(live.records || {}).length > 0) return live;
  } catch (err) {
    logger.warn("Live Plaud tree failed; using sync-index", {
      error: String(err?.message || err),
    });
  }
  return real;
}

export async function isReadablePath(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} stableId
 * @param {{
 *   loadIndex?: () => Promise<Record<string, any>>;
 *   isReadable?: (path: string) => Promise<boolean>;
 * }} [deps]
 * @returns {Promise<string | null>}
 */
export async function resolveSummaryPathAfterSync(
  stableId,
  { loadIndex = loadIndexForBot, isReadable = isReadablePath } = {}
) {
  const id = String(stableId || "").trim();
  if (!id) return null;
  const idx = await loadIndex();
  const record = getRecordByStableId(idx, id);
  const path = String(record?.summaryPath || "").trim();
  if (!path) return null;
  if (!(await isReadable(path))) return null;
  return path;
}
