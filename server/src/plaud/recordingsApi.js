/**
 * Endpoints that deal with the recordings list, filetags (folders), per-file
 * audio URLs, and a cheap session validator. All HTTP plumbing lives in
 * `httpTransport.js`; this module focuses on Plaud's quirky response shapes
 * and the per-folder fan-out the bot/CLI need to discover every recording.
 */
import { config } from "../config/config.js";
import { PlaudChangedError } from "./errors.js";
import { fetchPlaudApi } from "./httpTransport.js";
import {
  buildTagByIdMap,
  collectAllFilesFiletagIds,
  collectUnfiledFiletagIds,
  resolveFileFolderSegment,
  extractFiletagIdsFromRaw,
  mergeFiletagIds,
  mergeFiletagsById,
  parseFiletagListPayload,
} from "./plaudFolders.js";

const RAW_ID_KEYS = [
  "file_id",
  "fileId",
  "id",
  "recording_id",
  "recordingId",
  "audio_id",
  "audioId",
  "resource_id",
  "resourceId",
  "uuid",
];

export const TITLE_KEYS = [
  "file_name",
  "filename",
  "fileName",
  "file_title",
  "fileTitle",
  "name",
  "title",
  "display_name",
  "displayName",
  "audio_name",
  "recording_name",
  "topic",
  "recordingTitle",
];

function extractRawRecordingId(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  for (const key of RAW_ID_KEYS) {
    const value = raw[key];
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return "";
}

export function normalizeHumanTitle(value) {
  let s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      const decoded = decodeURIComponent(s).replace(/\s+/g, " ").trim();
      if (decoded) s = decoded;
    } catch {
      // ignore
    }
  }
  return s;
}

export function normalizePlaudFile(rawFile) {
  const id = extractRawRecordingId(rawFile);
  if (!id) return null;
  const rawTitle = TITLE_KEYS.map((k) => rawFile[k]).find(
    (v) => typeof v === "string" && v.trim()
  );
  const title = normalizeHumanTitle(rawTitle) || String(id);
  const folderIds = extractFiletagIdsFromRaw(rawFile);
  return { id, title, raw: rawFile, folderIds, folderSegment: "" };
}

function isFileLikeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return extractRawRecordingId(value).length > 0;
}

function collectQualifyingFileArrays(payload) {
  const collected = [];

  function pushIfQualifies(candidate) {
    if (!Array.isArray(candidate) || candidate.length === 0) return;
    if (!candidate.some(isFileLikeObject)) return;
    collected.push(candidate);
  }

  const directCandidates = [
    payload?.data?.data_file_list,
    payload?.data_file_list,
    payload?.data?.file_list,
    payload?.data?.files,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data?.records,
    payload?.file_list,
    payload?.files,
    payload?.list,
    payload?.items,
    payload?.data,
  ];

  for (const candidate of directCandidates) {
    pushIfQualifies(candidate);
  }

  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      pushIfQualifies(value);
      value.forEach(walk);
      return;
    }
    Object.values(value).forEach(walk);
  }
  walk(payload);

  const dedup = [];
  const seenArr = new Set();
  for (const arr of collected) {
    if (seenArr.has(arr)) continue;
    seenArr.add(arr);
    dedup.push(arr);
  }
  return dedup;
}

function extractServerListTotal(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload?.data?.total,
    payload?.data?.total_count,
    payload?.data?.count,
    payload?.data?.file_total,
    payload?.data?.total_num,
    payload?.total,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function mergeRawFilesFromArrays(arrays) {
  const byId = new Map();
  for (const arr of arrays) {
    for (const raw of arr) {
      if (!isFileLikeObject(raw)) continue;
      const id = extractRawRecordingId(raw);
      if (!id || byId.has(id)) continue;
      byId.set(id, raw);
    }
  }
  return [...byId.values()];
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
  } catch {
    buckets.push([]);
  }
  if (wa && wa !== ua) {
    try {
      buckets.push(await fetchPlaudFiletagListWithAuth(session, wa));
    } catch {
      // ignore
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
    const arrays = collectQualifyingFileArrays(payload);
    if (requireArrayOnFirstPage && skip === 0 && !arrays.length) {
      findFileArray(payload, { requireArray: true });
    }
    const rawLen = arrays.length ? Math.max(...arrays.map((a) => a.length)) : 0;
    const mergedRaw = mergeRawFilesFromArrays(arrays);
    const serverTotal = extractServerListTotal(payload);

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

    const done =
      serverTotal != null
        ? rawLen === 0 || (skip + rawLen >= serverTotal && rawLen < pageLimit)
        : rawLen === 0 || rawLen < pageLimit;
    if (done) break;
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
  } catch {
    tags = [];
  }
  const tagById = buildTagByIdMap(tags);
  const unfiledIds = new Set(collectUnfiledFiletagIds(tags));
  const allFilesIds = new Set(collectAllFilesFiletagIds(tags));
  return attachFolderSegments(files, tagById, unfiledIds, allFilesIds);
}

/**
 * Lightweight recordings pull for the Telegram bot's "Дерево синка" view:
 * just the global non-trash + (optionally) trash listings, enriched with
 * `folderSegment` from the filetag list. Skips the per-folder fan-out the
 * full sync uses — fast enough for an interactive callback handler.
 */
export async function listRecordingsForBotTree(session, options = {}) {
  return listAllRecordingsSimple(session, { includeTrash: true, ...options });
}

async function listAllRecordingsSimple(session, options = {}) {
  const { includeTrash = false, sortBy = session.sortBy } = options;
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
  if (!config.mirrorFolders) return files;
  return enrichFilesWithFolderSegments(session, files);
}

/**
 * Full workspace list: global pulls plus per-folder passes (extension parity).
 * When PLAUD_MIRROR_FOLDERS=false, only the global non-trash list is fetched.
 */
export async function listAllRecordings(session, options = {}) {
  const includeTrash =
    options.includeTrash ?? (config.mirrorFolders ? true : false);
  const { sortBy = session.sortBy } = options;

  if (!config.mirrorFolders) {
    return listAllRecordingsSimple(session, options);
  }

  let tags;
  try {
    tags = await fetchPlaudFiletagList(session);
  } catch {
    tags = [];
  }
  const tagById = buildTagByIdMap(tags);
  const unfiledIds = new Set(collectUnfiledFiletagIds(tags));
  const allFilesIds = new Set(collectAllFilesFiletagIds(tags));
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
    } catch {
      // Some query variants are unsupported on certain API builds.
    }
  }

  async function tryIngestFolder(folderId, opts) {
    await tryIngest({ is_trash: "2", filetag_id: folderId }, opts, folderId);
    if (unfiledIds.has(folderId)) {
      await tryIngest({ filetag_id: folderId }, opts, folderId);
    }
  }

  await tryIngest(
    { is_trash: "0" },
    { maxPages: 1, limitOverride: config.apiMaxFiles }
  );
  await tryIngest(
    { is_trash: "2" },
    { maxPages: 1, limitOverride: config.apiMaxFiles }
  );

  for (const params of [{ is_trash: "0" }, { is_trash: "2" }, {}]) {
    await tryIngest(params);
  }

  if (includeTrash) {
    await tryIngest({ is_trash: "1" });
  }

  for (const uid of unfiledIds) {
    await tryIngest({ is_trash: "2", filetag_id: uid });
    await tryIngest({ is_trash: "2", file_tag_id: uid });
    await tryIngest({ is_trash: "0", filetag_id: uid });
    await tryIngest({ is_trash: "0", file_tag_id: uid });
    await tryIngest({ filetag_id: uid });
    await tryIngest({ file_tag_id: uid });
  }

  await tryIngest({ is_trash: "2", filetag_id: "0" }, { maxPages: 20 });
  await tryIngest({ is_trash: "2", filetag_id: "-2" }, { maxPages: 20 });

  for (const sid of ["0", "-1", "-2"]) {
    await tryIngest({ is_trash: "2", tag_id: sid }, { maxPages: 20 });
    await tryIngest({ is_trash: "2", folder_id: sid }, { maxPages: 20 });
  }

  const folderIds = new Set(unfiledIds);
  for (const tag of tags) {
    const id = tag?.id ?? tag?.filetag_id ?? tag?.tag_id ?? tag?.folder_id;
    if (id != null && String(id).trim()) folderIds.add(String(id).trim());
  }

  const maxFolderPulls = 400;
  let pulls = 0;
  for (const fid of folderIds) {
    if (pulls >= maxFolderPulls) break;
    pulls++;
    await tryIngestFolder(fid, { maxPages: 80 });
  }

  await tryIngest({ is_trash: "2", filetag_id: "-1" }, { maxPages: 15 });
  await tryIngest({ filetag_id: "-1" }, { maxPages: 15 });

  return attachFolderSegments([...byId.values()], tagById, unfiledIds, allFilesIds);
}

function findFileArray(payload, { requireArray = false } = {}) {
  const candidates = [
    payload?.data?.data_file_list,
    payload?.data_file_list,
    payload?.data?.file_list,
    payload?.data?.files,
    payload?.data,
    payload?.data?.data,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data?.records,
    payload?.file_list,
    payload?.files,
    payload?.list,
    payload?.items,
  ];
  const found = candidates.find(Array.isArray);
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
