/**
 * Endpoints that deal with the recordings list, filetags (folders), per-file
 * audio URLs, and a cheap session validator. All HTTP plumbing lives in
 * `httpTransport.js`; this module focuses on Plaud's quirky response shapes
 * and the per-folder fan-out the bot/CLI need to discover every recording.
 */
import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { PlaudChangedError } from "./errors.js";
import { fetchPlaudApi } from "./httpTransport.js";
import {
  listAllOfficialRecordings,
  validateOfficialSession,
} from "./officialPlaudApi.js";
import {
  buildPlaudRecordingFanoutPlan,
  collectPlaudRecordingArrays,
  extractPlaudRecordingTotal,
  isPlaudRecordingPageDone,
  mergeRawPlaudRecordings,
  normalizePlaudRecording,
} from "../../../plaud-exporter/common/plaudRecordings.js";
import {
  extractFiletagIdsFromRaw,
  mergeFiletagIds,
  mergeFiletagsById,
  parseFiletagListPayload,
  resolveFileFolderSegment,
} from "./plaudFolders.js";
import { buildFolderResolutionContext } from "./folderResolution.js";

export {
  TITLE_KEYS,
  normalizeHumanTitle,
} from "../../../plaud-exporter/common/plaudTitles.js";

export function normalizePlaudFile(rawFile) {
  return normalizePlaudRecording(rawFile);
}

async function fetchPlaudFiletagListWithAuth(session, authHeader) {
  const headers = authHeader ? { Authorization: authHeader } : {};
  try {
    const payload = await fetchPlaudApi(session, "/filetag/", { headers });
    return parseFiletagListPayload(payload);
  } catch {
    const payload = await fetchPlaudApi(session, "/filetag", { headers });
    return parseFiletagListPayload(payload);
  }
}

export async function fetchPlaudFiletagList(session) {
  const ua = session.userAuthHeader || session.authHeader || "";
  const wa = session.workspaceAuthHeader || "";
  const buckets = [];
  try {
    buckets.push(await fetchPlaudFiletagListWithAuth(session, ua));
  } catch (err) {
    logger.warn("recordingsApi: user-auth filetag list failed", {
      error: String(err?.message || err),
    });
    buckets.push([]);
  }
  if (wa && wa !== ua) {
    try {
      buckets.push(await fetchPlaudFiletagListWithAuth(session, wa));
    } catch (err) {
      logger.warn("recordingsApi: workspace-auth filetag list failed", {
        error: String(err?.message || err),
      });
    }
  }
  return mergeFiletagsById(buckets);
}

async function fetchRecordingsVariant(session, fixedParams, opts = {}) {
  const { sortBy = session.sortBy, requireArrayOnFirstPage = false } = opts;
  const maxPagesRaw = Number(opts.maxPages);
  const maxPages =
    Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? maxPagesRaw : Infinity;
  const limitOverride = Number(opts.limitOverride);
  const pageLimit =
    Number.isFinite(limitOverride) &&
    limitOverride > 0 &&
    limitOverride <= config.apiMaxFiles
      ? Math.floor(limitOverride)
      : config.apiPageLimit;

  const files = [];
  const seenIds = new Set();
  let pagesFetched = 0;

  for (let skip = 0; skip < config.apiMaxFiles; skip += pageLimit) {
    const query = new URLSearchParams({
      skip: String(skip),
      limit: String(pageLimit),
      sort_by: sortBy || "start_time",
      is_desc: "true",
      r: String(Math.random()),
      ...fixedParams,
    });
    const payload = await fetchPlaudApi(
      session,
      `/file/simple/web?${query.toString()}`
    );
    const arrays = collectPlaudRecordingArrays(payload);
    if (requireArrayOnFirstPage && skip === 0 && !arrays.length) {
      findFileArray(payload, { requireArray: true });
    }
    const rawLen = arrays.length ? Math.max(...arrays.map((a) => a.length)) : 0;
    const mergedRaw = mergeRawPlaudRecordings(arrays);
    const serverTotal = extractPlaudRecordingTotal(payload);

    const pageFiles = mergedRaw
      .map(normalizePlaudFile)
      .filter(Boolean)
      .filter((file) => {
        if (seenIds.has(file.id)) return false;
        seenIds.add(file.id);
        return true;
      });

    files.push(...pageFiles);
    pagesFetched++;
    if (pagesFetched >= maxPages) break;

    if (isPlaudRecordingPageDone({ serverTotal, rawLen, skip, pageLimit })) {
      break;
    }
  }

  return files;
}

function attachFolderSegments(files, tagById, unfiledIds, allFilesIds) {
  for (const file of files) {
    file.folderSegment = resolveFileFolderSegment({
      folderIds: file.folderIds,
      raw: file.raw,
      tagById,
      unfiledIds,
      allFilesIds,
    });
  }
  return files;
}

async function enrichFilesWithFolderSegments(session, files) {
  if (!files.length) return files;
  let tags;
  try {
    tags = await fetchPlaudFiletagList(session);
  } catch (err) {
    logger.warn(
      "recordingsApi: filetag list unavailable for folder enrichment",
      {
        error: String(err?.message || err),
      }
    );
    tags = [];
  }
  const { tagById, unfiledIds, allFilesIds } =
    buildFolderResolutionContext(tags);
  return attachFolderSegments(files, tagById, unfiledIds, allFilesIds);
}

/**
 * Lightweight recordings pull for the Telegram bot's "Дерево синка" view:
 * global non-trash + trash listings without per-folder fan-out.
 * Folder segments are resolved by `liveTreeReadModel` from its own tag fetch.
 */
export async function listRecordingsForBotTree(session, options = {}) {
  return listAllRecordingsSimple(session, {
    includeTrash: true,
    skipFolderEnrichment: true,
    ...options,
  });
}

async function listAllRecordingsSimple(session, options = {}) {
  const {
    includeTrash = false,
    sortBy = session.sortBy,
    skipFolderEnrichment = false,
  } = options;
  const variants = includeTrash ? ["0", "1"] : ["0"];
  const byId = new Map();

  for (const trashFlag of variants) {
    const batch = await fetchRecordingsVariant(
      session,
      { is_trash: trashFlag },
      {
        sortBy,
        maxPages: Infinity,
        requireArrayOnFirstPage: trashFlag === "0",
      }
    );
    for (const file of batch) {
      if (!byId.has(file.id)) byId.set(file.id, file);
    }
  }

  const files = [...byId.values()];
  if (!config.mirrorFolders || skipFolderEnrichment) return files;
  return enrichFilesWithFolderSegments(session, files);
}

/**
 * Full workspace list: global pulls plus per-folder passes (extension parity).
 * When PLAUD_MIRROR_FOLDERS=false, only the global non-trash list is fetched.
 */
export async function listAllRecordings(session, options = {}) {
  if (session?.apiMode === "official") {
    return listAllOfficialRecordings(session);
  }
  const includeTrash =
    options.includeTrash ?? (config.mirrorFolders ? true : false);
  const { sortBy = session.sortBy } = options;

  if (!config.mirrorFolders) {
    return listAllRecordingsSimple(session, options);
  }

  let tags;
  try {
    tags = await fetchPlaudFiletagList(session);
  } catch (err) {
    logger.warn(
      "recordingsApi: filetag list unavailable for folder enrichment",
      {
        error: String(err?.message || err),
      }
    );
    tags = [];
  }
  const { tagById, unfiledIds, allFilesIds } =
    buildFolderResolutionContext(tags);
  const byId = new Map();

  function ingest(list, contextFolderId = "") {
    for (const file of list) {
      const fromRaw = extractFiletagIdsFromRaw(file.raw);
      const folderIds = mergeFiletagIds(
        file.folderIds,
        fromRaw,
        contextFolderId ? [contextFolderId] : []
      );
      const merged = { ...file, folderIds };
      const existing = byId.get(file.id);
      if (existing) {
        merged.folderIds = mergeFiletagIds(existing.folderIds, folderIds);
      }
      byId.set(file.id, merged);
    }
  }

  async function tryIngest(params, opts, contextFolderId = "") {
    try {
      ingest(
        await fetchRecordingsVariant(session, params, { sortBy, ...opts }),
        contextFolderId
      );
    } catch (err) {
      logger.warn("recordingsApi: recordings list variant failed", {
        params,
        contextFolderId: contextFolderId || undefined,
        error: String(err?.message || err),
      });
    }
  }

  for (const step of buildPlaudRecordingFanoutPlan({
    tags,
    unfiledIds,
    includeTrash,
    maxFiles: config.apiMaxFiles,
  })) {
    await tryIngest(step.params, step.opts, step.contextFolderId);
  }

  return attachFolderSegments(
    [...byId.values()],
    tagById,
    unfiledIds,
    allFilesIds
  );
}

function findFileArray(payload, { requireArray = false } = {}) {
  const found = collectPlaudRecordingArrays(payload)[0];
  if (found) return found;
  if (requireArray && payload && typeof payload === "object") {
    throw new PlaudChangedError(
      "Plaud recordings list response has an unexpected shape; no file array found.",
      { endpoint: "/file/simple/web" }
    );
  }
  return [];
}

/**
 * Cheap connectivity check — used at the end of `server:auth` to fail fast if
 * the snapshot does not actually work. Returns the number of items returned.
 */
export async function validateSession(session) {
  if (session?.apiMode === "official") {
    return validateOfficialSession(session);
  }
  const payload = await fetchPlaudApi(
    session,
    `/file/simple/web?${new URLSearchParams({
      skip: "0",
      limit: "1",
      sort_by: session.sortBy || "start_time",
      is_desc: "true",
      r: String(Math.random()),
      is_trash: "0",
    }).toString()}`
  );
  const arr = findFileArray(payload);
  return arr.length;
}
