/**
 * Live Plaud tree read model: filetags + recordings → synthetic sync-index.
 * Used by Telegram tree browse; presentation stays in telegram/.
 */

import { createPlaudSessionLoader } from "../auth/loadPlaudSession.js";
import { logger } from "../logger.js";
import { buildStableId } from "../../../browser-extension/common/syncCore.js";
import { resolveFileFolderSegment } from "./plaudFolders.js";
import { buildFolderResolutionContext } from "./folderResolution.js";
import {
  fetchPlaudFiletagList,
  listRecordingsForBotTree,
} from "./plaudApiClient.js";
import {
  getRecordingCreatedAtIso,
  getRecordingCreatedAtRaw,
} from "./recordingTimestamps.js";

export const LIVE_TREE_CACHE_TTL_MS = 15_000;

const STATUS_NOT_SYNCED = "not_synced";

const defaultSessionLoader = createPlaudSessionLoader("liveTreeReadModel");

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
 *   syncIndex?: object | null;
 *   sessionLoader?: () => Promise<object | null>;
 *   fetchTags?: (session: object) => Promise<object[]>;
 *   fetchRecordings?: (session: object, options?: object) => Promise<object[]>;
 *   now?: number;
 *   forceRefresh?: boolean;
 * }} [params]
 * @returns {Promise<LiveTreeSyncIndex | null>}
 */
export async function loadPlaudLiveSyncTree({
  syncIndex = null,
  sessionLoader = defaultSessionLoader,
  fetchTags = fetchPlaudFiletagList,
  fetchRecordings = listRecordingsForBotTree,
  now = Date.now(),
  forceRefresh = false,
} = {}) {
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
    const createdAtRaw = getRecordingCreatedAtRaw(file.raw);
    const createdAtIso = getRecordingCreatedAtIso(file.raw);
    const identity = buildStableId({
      ...file,
      raw: file.raw,
      title: String(file.title || "").trim(),
      // Match syncRunner: raw Plaud timestamp for fingerprint parity.
      createdAt: createdAtRaw,
    });
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
 * @param {object | null | undefined} syncIndex
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

export { STATUS_NOT_SYNCED };
