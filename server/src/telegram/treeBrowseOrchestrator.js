/**
 * Tree browse orchestration without Telegram I/O.
 */

import { access } from "node:fs/promises";
import { logger } from "../logger.js";
import { getRecordByStableId, loadIndexForBot } from "../sync/syncIndexRead.js";
import { loadPlaudLiveSyncTree } from "../plaud/liveTreeReadModel.js";

/** @type {{ loadIndex?: () => Promise<Record<string, any>>, loadLive?: (args: Record<string, any>) => Promise<Record<string, any> | null> } | null} */
let _testHooks = null;

/** @param {{ loadIndex?: () => Promise<Record<string, any>>, loadLive?: (args: Record<string, any>) => Promise<Record<string, any> | null> } | null} hooks */
export function _setTreeBrowseOrchestratorHooksForTests(hooks) {
  _testHooks = hooks;
}

export function _resetTreeBrowseOrchestratorHooksForTests() {
  _testHooks = null;
}

/**
 * Returns a sync-index-shaped object to feed the tree builders. Prefers a
 * live Plaud snapshot and falls back to the on-disk sync-index.
 *
 * @param {{ sessionLoader: () => Promise<import("../auth/plaudSessionExtractor.js").PlaudSession | null> }} params
 */
export async function loadTreeSource({ sessionLoader }) {
  const real = _testHooks?.loadIndex
    ? await _testHooks.loadIndex()
    : await loadIndexForBot();
  try {
    const loadLive =
      _testHooks?.loadLive ||
      ((args) =>
        loadPlaudLiveSyncTree({
          ...args,
          sessionLoader,
        }));
    const live = await loadLive({ syncIndex: real });
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
 * @returns {Promise<string | null>}
 */
export async function resolveSummaryPathAfterSync(stableId) {
  const id = String(stableId || "").trim();
  if (!id) return null;
  const idx = _testHooks?.loadIndex
    ? await _testHooks.loadIndex()
    : await loadIndexForBot();
  const record = getRecordByStableId(idx, id);
  const path = String(record?.summaryPath || "").trim();
  if (!path) return null;
  if (!(await isReadablePath(path))) return null;
  return path;
}
