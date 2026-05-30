/**
 * Live "Дерево синка" view for the Telegram bot.
 *
 * The bot's tree screen used to read folder structure straight from the local
 * sync-index. That works only when records have populated `folderSegment` and
 * `summaryPath` matching Plaud's current folders — legacy / partially-synced
 * data collapses to a single "Unfiled" bucket because there is no folder hint
 * to recover from.
 *
 * This module fetches the Plaud filetag list + a lightweight recordings pull
 * and assembles a *synthetic* sync-index whose records carry the proper
 * `folderSegment`. The bot then reuses `buildSyncIndexTreeRoot` /
 * `buildSyncIndexFolderPage` unchanged, so the rendering stays in one place.
 *
 * The synthetic records also remember `status` from the real sync-index where
 * available (so the file listing inside a folder shows `success / updated /
 * error` correctly) and tag everything else as `not_synced` so users see
 * which Plaud files have not landed in the vault yet.
 */

import {
  assertSnapshotReadyForApi,
  createSessionFromSnapshot,
} from "../auth/plaudSessionExtractor.js";
import { loadSessionSnapshot } from "../auth/sessionStore.js";
import { logger } from "../logger.js";
import {
  fetchPlaudFiletagList,
  listRecordingsForBotTree,
} from "../plaud/plaudApiClient.js";
import {
  buildTagByIdMap,
  collectAllFilesFiletagIds,
  collectUnfiledFiletagIds,
  isAllFilesMetaTag,
  resolveFileFolderSegment,
} from "../plaud/plaudFolders.js";
import { buildStableId } from "../../../plaud-exporter/common/syncCore.js";

export const LIVE_TREE_CACHE_TTL_MS = 15_000;

const STATUS_NOT_SYNCED = "not_synced";

function toIsoFromAny(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const direct = new Date(String(value));
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return "";
}

function extractCreatedAtIso(raw) {
  if (!raw || typeof raw !== "object") return "";
  const candidates = [
    raw.created_at,
    raw.createdAt,
    raw.create_time,
    raw.createTime,
    raw.start_time,
    raw.startTime,
  ];
  for (const v of candidates) {
    const iso = toIsoFromAny(v);
    if (iso) return iso;
  }
  return "";
}

async function defaultSessionLoader() {
  const snap = await loadSessionSnapshot();
  if (!snap) return null;
  try {
    assertSnapshotReadyForApi(snap);
    return createSessionFromSnapshot(snap);
  } catch (err) {
    logger.warn("plaudLiveTree: session snapshot present but unusable", {
      error: String(err?.message || err),
    });
    return null;
  }
}

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
 * Fetches the Plaud filetag list + recordings (cached for a short TTL) and
 * returns a *synthetic* sync-index annotated with each file's live Plaud
 * folder. Sync status from `realSyncIndex` is merged in so the file listing
 * inside a folder reflects what is actually on disk.
 *
 * @param {{
 *   syncIndex?: object | null;
 *   sessionLoader?: () => Promise<object | null>;
 *   fetchTags?: (session: object) => Promise<object[]>;
 *   fetchRecordings?: (session: object, options?: object) => Promise<object[]>;
 *   now?: number;
 *   forceRefresh?: boolean;
 * }} [params]
 * @returns {Promise<LiveTreeSyncIndex | null>} null when no usable Plaud session.
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
    logger.warn("plaudLiveTree: live fetch failed", {
      error: String(err?.message || err),
    });
    return null;
  }

  const allFilesIds = new Set(collectAllFilesFiletagIds(tags || []));
  const filteredTags = (tags || []).filter((t) => !isAllFilesMetaTag(t));
  const tagById = buildTagByIdMap(filteredTags);
  const unfiledIds = new Set(collectUnfiledFiletagIds(filteredTags));

  /** @type {Record<string, LiveTreeRecord>} */
  const records = {};
  for (const file of files || []) {
    if (!file || typeof file !== "object") continue;
    const createdAtIso = extractCreatedAtIso(file.raw);
    const identity = buildStableId({
      ...file,
      raw: file.raw,
      title: String(file.title || "").trim(),
      createdAt: createdAtIso,
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
 * Overlays sync-index data (status, summaryPath, vault title) on top of the
 * live snapshot so the per-folder listing shows accurate sync state. Live
 * `folderSegment` always wins so the bucketing matches Plaud's truth.
 *
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
        lastSyncedAt:
          live.lastSyncedAt || String(real.lastSyncedAt || ""),
      };
    } else {
      merged[id] = { ...live };
    }
  }
  return { records: merged };
}

export { isAllFilesMetaTag, STATUS_NOT_SYNCED };
