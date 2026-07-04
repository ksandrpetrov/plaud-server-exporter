import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { PlaudChangedError } from "./errors.js";
import { fetchPlaudApi } from "./httpTransport.js";
import { listAllOfficialRecordings } from "./officialPlaudApi.js";
import {
  buildPlaudRecordingFanoutPlan,
  collectPlaudRecordingArrays,
  paginatePlaudRecordingVariant,
  runPlaudRecordingFanout,
} from "../../../browser-extension/common/plaudRecordings.js";
import { resolveFileFolderSegment } from "./plaudFolders.js";
import { buildFolderResolutionContext } from "./folderResolution.js";
import { fetchPlaudFiletagList } from "./filetagApi.js";

export async function fetchRecordingsVariant(session, fixedParams, opts = {}) {
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

  return paginatePlaudRecordingVariant({
    fetchPage: async (query) => {
      const qs = new URLSearchParams(query).toString();
      return fetchPlaudApi(session, `/file/simple/web?${qs}`);
    },
    fixedParams,
    sortBy,
    pageLimit,
    maxFiles: config.apiMaxFiles,
    maxPages,
    isDesc: opts.isDesc !== false,
    requireArrayOnFirstPage,
    onMissingFirstPageArray: requireArrayOnFirstPage
      ? (payload) => {
          findFileArray(payload, { requireArray: true });
        }
      : undefined,
  });
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

export async function listAllRecordingsSimple(session, options = {}) {
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

  const files = await runPlaudRecordingFanout({
    fetchVariant: (params, variantOpts) =>
      fetchRecordingsVariant(session, params, { sortBy, ...variantOpts }),
    plan: buildPlaudRecordingFanoutPlan({
      tags,
      unfiledIds,
      includeTrash,
      maxFiles: config.apiMaxFiles,
    }),
    onVariantError: (err, step) => {
      logger.warn("recordingsApi: recordings list variant failed", {
        params: step.params,
        contextFolderId: step.contextFolderId || undefined,
        error: String(err instanceof Error ? err.message : err),
      });
    },
  });

  return attachFolderSegments(files, tagById, unfiledIds, allFilesIds);
}

export function findFileArray(payload, { requireArray = false } = {}) {
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
