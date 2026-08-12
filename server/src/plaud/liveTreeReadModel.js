/**
 * Live Plaud tree read model: filetags + recordings → synthetic sync-index.
 * Used by Telegram tree browse; presentation stays in telegram/.
 */

import { logger } from "../logger.js";
import { buildLiveTreeStableIdentity } from "../sync/stableIdentity.js";
import { resolveFileFolderSegment } from "./plaudFolders.js";
import { buildFolderResolutionContext } from "./folderResolution.js";
import {
  fetchPlaudFiletagList,
  listRecordingsForBotTree,
} from "./plaudApiClient.js";
import { getRecordingCreatedAtIso } from "./recordingTimestamps.js";

const LIVE_TREE_CACHE_TTL_MS = 15_000;

const STATUS_NOT_SYNCED = "not_synced";

let cache = null;
let cachedAtMs = 0;

export function _resetPlaudLiveTreeCache() {
  cache = null;
  cachedAtMs = 0;
}

/**
 * @typedef {{
 *   stableId: string;
 *   title: string;
 *   status: string;
 *   summaryPath: string;
 *   lastSyncedAt: string;
 *   folderSegment: string;
 * }} LiveTreeRecord
 */

/**
 * @typedef {{ records: Record<string, LiveTreeRecord> }} LiveTreeSyncIndex
 */

/**
 * @param {{
 *   syncIndex?: Record<string, any> | null;
 *   sessionLoader?: () => Promise<import("../auth/plaudSessionExtractor.js").PlaudSession | null>;
 *   fetchTags?: (session: import("../auth/plaudSessionExtractor.js").PlaudSession) => Promise<Array<Record<string, any>>>;
 *   fetchRecordings?: (session: import("../auth/plaudSessionExtractor.js").PlaudSession, options?: Record<string, any>) => Promise<Array<Record<string, any>>>;
 *   now?: number;
 *   forceRefresh?: boolean;
 * }} [params]
 * @returns {Promise<LiveTreeSyncIndex | null>}
 */
export async function loadPlaudLiveSyncTree({
  syncIndex = null,
  sessionLoader,
  fetchTags = fetchPlaudFiletagList,
  fetchRecordings = listRecordingsForBotTree,
  now = Date.now(),
  forceRefresh = false,
} = {}) {
  if (!sessionLoader) return null;
  if (!forceRefresh && cache && now - cachedAtMs < LIVE_TREE_CACHE_TTL_MS) {
    return mergeWithSyncIndex(cache, syncIndex);
  }

  const session = await sessionLoader();
  if (!session) return null;

  let tags;
  let files;
  try {
    tags = await fetchTags(session);
    files = await fetchRecordings(session, { includeTrash: true });
  } catch (err) {
    logger.warn("liveTreeReadModel: live fetch failed", {
      error: String(err?.message || err),
    });
    return null;
  }

  const { tagById, unfiledIds, allFilesIds } = buildFolderResolutionContext(
    tags,
    { excludeAllFilesMetaTags: true }
  );

  /** @type {Record<string, LiveTreeRecord>} */
  const records = {};
  for (const file of files || []) {
    if (!file || typeof file !== "object") continue;
    const createdAtIso = getRecordingCreatedAtIso(file.raw);
    const identity = buildLiveTreeStableIdentity(file);
    if (identity.identityKind === "missing" || !identity.stableId) continue;
    const stableId = identity.stableId;
    const folderSegment = resolveFileFolderSegment({
      folderIds: file.folderIds,
      raw: file.raw,
      tagById,
      unfiledIds,
      allFilesIds,
    });
    records[stableId] = {
      stableId,
      title: String(file.title || "").trim(),
      status: STATUS_NOT_SYNCED,
      summaryPath: "",
      lastSyncedAt: createdAtIso,
      folderSegment,
    };
  }

  cache = { records };
  cachedAtMs = now;
  return mergeWithSyncIndex(cache, syncIndex);
}

/**
 * @param {LiveTreeSyncIndex} liveTree
 * @param {Record<string, any> | null | undefined} syncIndex
 * @returns {LiveTreeSyncIndex}
 */
function mergeWithSyncIndex(liveTree, syncIndex) {
  if (!liveTree) return liveTree;
  const realRecords =
    syncIndex && typeof syncIndex === "object" && syncIndex.records
      ? syncIndex.records
      : null;
  if (!realRecords) {
    return { records: { ...liveTree.records } };
  }
  /** @type {Record<string, LiveTreeRecord>} */
  const merged = {};
  for (const [id, live] of Object.entries(liveTree.records)) {
    const real = realRecords[id];
    if (real) {
      merged[id] = {
        ...live,
        title: live.title || String(real.title || "").trim() || live.title,
        status: String(real.status || "") || STATUS_NOT_SYNCED,
        summaryPath: String(real.summaryPath || ""),
        lastSyncedAt: live.lastSyncedAt || String(real.lastSyncedAt || ""),
      };
    } else {
      merged[id] = { ...live };
    }
  }
  return { records: merged };
}
