/**
 * Shared Plaud `/file/simple/web` response handling.
 *
 * This module is deliberately pure: no fetch, no Chrome APIs, no Node APIs.
 * Server and extension provide transport/session/logging, while this file
 * owns Plaud's unstable list payload shapes and the folder fan-out recipe.
 */
import {
  extractRawRecordingId,
  normalizePlaudRecordingId,
} from "./plaudRecordingIds.js";
import {
  collectUnfiledFiletagIds,
  extractFiletagIdsFromRaw,
  isTrashSidebarTag,
  mergeFiletagIds,
} from "./plaudFolders.js";
import { normalizeHumanTitle, pickRawTitleFromFile } from "./plaudTitles.js";

function isPlaudRecordingLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return extractRawRecordingId(value).length > 0;
}

function listPlaudRecordingArrayCandidates(payload) {
  return [
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
    payload?.data?.data,
  ];
}

/**
 * Normalize one raw Plaud recording row into the shared file shape.
 *
 * @param {Record<string, any> | null | undefined} rawFile
 * @returns {{ id: string; title: string; raw: object; folderIds: string[]; folderSegment: string } | null}
 */
export function normalizePlaudRecording(rawFile) {
  const id = normalizePlaudRecordingId(rawFile);
  if (!id || !rawFile || typeof rawFile !== "object") return null;
  const title =
    normalizeHumanTitle(pickRawTitleFromFile(rawFile)) || String(id);
  return {
    id,
    title,
    raw: rawFile,
    folderIds: extractFiletagIdsFromRaw(rawFile),
    folderSegment: "",
  };
}

/**
 * Collect arrays that plausibly contain Plaud recording rows.
 *
 * Direct known response fields are accepted even when empty so callers can
 * distinguish a valid empty list from an unexpected response shape.
 *
 * @param {unknown} payload
 * @returns {unknown[][]}
 */
export function collectPlaudRecordingArrays(payload) {
  const collected = [];

  function pushIfQualifies(candidate, { allowEmpty = false } = {}) {
    if (!Array.isArray(candidate)) return;
    if (!candidate.length) {
      if (allowEmpty) collected.push(candidate);
      return;
    }
    if (!candidate.some(isPlaudRecordingLike)) return;
    collected.push(candidate);
  }

  for (const candidate of listPlaudRecordingArrayCandidates(payload)) {
    pushIfQualifies(candidate, { allowEmpty: true });
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
  const seenArrays = new Set();
  for (const arr of collected) {
    if (seenArrays.has(arr)) continue;
    seenArrays.add(arr);
    dedup.push(arr);
  }
  return dedup;
}

/**
 * @param {unknown} payload
 * @returns {number | null}
 */
export function extractPlaudRecordingTotal(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = /** @type {any} */ (payload).data;
  const candidates = [
    /** @type {any} */ (payload).data_file_total,
    data?.data_file_total,
    data?.total,
    data?.total_count,
    data?.count,
    data?.file_total,
    data?.total_num,
    /** @type {any} */ (payload).total,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Merge raw rows from one or more arrays, deduping by normalized Plaud id.
 *
 * @param {unknown[][]} arrays
 * @returns {object[]}
 */
export function mergeRawPlaudRecordings(arrays) {
  const byId = new Map();
  for (const arr of arrays || []) {
    for (const raw of arr || []) {
      if (!isPlaudRecordingLike(raw)) continue;
      const id =
        normalizePlaudRecordingId(raw) || String(extractRawRecordingId(raw));
      if (!id || byId.has(id)) continue;
      byId.set(id, raw);
    }
  }
  return [...byId.values()];
}

/**
 * Plaud sometimes reports `total` equal to the current page size. Only stop
 * early on total when the page is not full; otherwise keep paginating.
 *
 * @param {{ serverTotal?: number | null; rawLen: number; skip: number; pageLimit: number }} page
 */
export function isPlaudRecordingPageDone(page) {
  const serverTotal = page.serverTotal === undefined ? null : page.serverTotal;
  const rawLen = Number(page.rawLen) || 0;
  const skip = Number(page.skip) || 0;
  const pageLimit = Math.max(1, Number(page.pageLimit) || 1);

  if (serverTotal != null) {
    return rawLen === 0 || (skip + rawLen >= serverTotal && rawLen < pageLimit);
  }
  return rawLen === 0 || rawLen < pageLimit;
}

function tagId(tag) {
  const id = tag?.id ?? tag?.filetag_id ?? tag?.tag_id ?? tag?.folder_id;
  if (id == null) return "";
  return String(id).trim();
}

function pushStep(steps, params, opts, contextFolderId = "") {
  steps.push({
    params,
    opts: opts || {},
    contextFolderId,
  });
}

/** Desc + asc passes — Plaud `/file/simple/web` often caps skip near ~400 per sort. */
function pushSortPair(steps, params, opts, contextFolderId = "") {
  pushStep(steps, params, opts, contextFolderId);
  pushStep(steps, params, { ...(opts || {}), isDesc: false }, contextFolderId);
}

/**
 * Build the shared fan-out plan used to discover all workspace recordings.
 *
 * @param {{
 *   tags?: object[] | null;
 *   unfiledIds?: Iterable<string>;
 *   includeTrash?: boolean;
 *   maxFiles?: number;
 *   maxFolderPulls?: number;
 *   folderMaxPages?: number;
 * }} [options]
 * @returns {Array<{ params: Record<string, string>; opts: Record<string, number>; contextFolderId: string }>}
 */
export function buildPlaudRecordingFanoutPlan(options = {}) {
  const tags = Array.isArray(options.tags) ? options.tags : [];
  const rawUnfiledIds = options.unfiledIds || collectUnfiledFiletagIds(tags);
  const unfiledIds = new Set(
    [...rawUnfiledIds].map((id) => String(id).trim()).filter(Boolean)
  );
  const includeTrash = options.includeTrash !== false;
  const maxFolderPulls = Number.isFinite(Number(options.maxFolderPulls))
    ? Math.max(0, Math.floor(Number(options.maxFolderPulls)))
    : 400;
  const folderMaxPages = Number.isFinite(Number(options.folderMaxPages))
    ? Math.max(1, Math.floor(Number(options.folderMaxPages)))
    : 80;

  const steps = [];

  for (const params of [{ is_trash: "0" }, { is_trash: "2" }, {}]) {
    pushSortPair(steps, params);
  }

  if (includeTrash) {
    pushSortPair(steps, { is_trash: "1" });
  }

  for (const uid of unfiledIds) {
    pushStep(steps, { is_trash: "2", filetag_id: uid });
    pushStep(steps, { is_trash: "2", file_tag_id: uid });
    pushStep(steps, { is_trash: "0", filetag_id: uid });
    pushStep(steps, { is_trash: "0", file_tag_id: uid });
    pushStep(steps, { filetag_id: uid });
    pushStep(steps, { file_tag_id: uid });
  }

  pushSortPair(steps, { is_trash: "2", filetag_id: "0" }, { maxPages: 20 });
  pushSortPair(steps, { is_trash: "2", filetag_id: "-2" }, { maxPages: 20 });

  for (const sid of ["0", "-1", "-2"]) {
    pushSortPair(steps, { is_trash: "2", tag_id: sid }, { maxPages: 20 });
    pushSortPair(steps, { is_trash: "2", folder_id: sid }, { maxPages: 20 });
  }

  const folderIds = new Set(unfiledIds);
  for (const tag of tags) {
    if (!tag || typeof tag !== "object" || isTrashSidebarTag(tag)) continue;
    const id = tagId(tag);
    if (id) folderIds.add(id);
  }

  let pulls = 0;
  for (const folderId of folderIds) {
    if (pulls >= maxFolderPulls) break;
    pulls++;
    pushSortPair(
      steps,
      { is_trash: "2", filetag_id: folderId },
      { maxPages: folderMaxPages },
      folderId
    );
    if (unfiledIds.has(folderId)) {
      pushSortPair(
        steps,
        { filetag_id: folderId },
        { maxPages: folderMaxPages },
        folderId
      );
    }
  }

  pushSortPair(steps, { is_trash: "2", filetag_id: "-1" }, { maxPages: 15 });
  pushSortPair(steps, { filetag_id: "-1" }, { maxPages: 15 });
  return steps;
}

/**
 * Paginate one `/file/simple/web` variant and return normalized recordings.
 * Transport is injected so server and extension can share the loop.
 *
 * @param {{
 *   fetchPage: (query: Record<string, string>) => Promise<unknown>;
 *   fixedParams?: Record<string, string>;
 *   sortBy?: string;
 *   pageLimit: number;
 *   maxFiles: number;
 *   maxPages?: number;
 *   isDesc?: boolean;
 *   requireArrayOnFirstPage?: boolean;
 *   onMissingFirstPageArray?: (payload: unknown) => void;
 * }} options
 * @returns {Promise<NonNullable<ReturnType<typeof normalizePlaudRecording>>[]>}
 */
export async function paginatePlaudRecordingVariant(options) {
  const {
    fetchPage,
    fixedParams = {},
    sortBy = "start_time",
    requireArrayOnFirstPage = false,
    onMissingFirstPageArray,
  } = options;

  const maxPagesRaw = Number(options.maxPages);
  const maxPages =
    Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? maxPagesRaw : Infinity;
  const limit = Math.max(1, Math.floor(Number(options.pageLimit) || 1));
  const cap = Math.max(limit, Math.floor(Number(options.maxFiles) || limit));
  const isDesc = options.isDesc !== false;

  const files = [];
  const seenIds = new Set();
  let pagesFetched = 0;

  for (let skip = 0; skip < cap; skip += limit) {
    const query = {
      skip: String(skip),
      limit: String(limit),
      sort_by: sortBy || "start_time",
      is_desc: isDesc ? "true" : "false",
      r: String(Math.random()),
      ...fixedParams,
    };
    const payload = await fetchPage(query);
    const arrays = collectPlaudRecordingArrays(payload);

    if (requireArrayOnFirstPage && skip === 0 && !arrays.length) {
      onMissingFirstPageArray?.(payload);
    }

    const rawLen = arrays.length ? Math.max(...arrays.map((a) => a.length)) : 0;
    const mergedRaw = mergeRawPlaudRecordings(arrays);
    const serverTotal = extractPlaudRecordingTotal(payload);

    const pageFiles = mergedRaw
      .map(normalizePlaudRecording)
      .filter(Boolean)
      .filter((file) => {
        if (seenIds.has(file.id)) return false;
        seenIds.add(file.id);
        return true;
      });

    files.push(...pageFiles);
    pagesFetched++;
    if (pagesFetched >= maxPages) break;

    if (
      isPlaudRecordingPageDone({ serverTotal, rawLen, skip, pageLimit: limit })
    ) {
      break;
    }
  }

  return files;
}

/**
 * Merge helper for fan-out pulls that may return the same recording under
 * different folder query contexts.
 *
 * @returns {{
 *   ingest: (
 *     list: Array<NonNullable<ReturnType<typeof normalizePlaudRecording>>>,
 *     contextFolderId?: string
 *   ) => void;
 *   values: () => Array<NonNullable<ReturnType<typeof normalizePlaudRecording>>>;
 * }}
 */
export function createPlaudRecordingIngestor() {
  const byId = new Map();

  function ingest(list, contextFolderId = "") {
    for (const file of list || []) {
      if (!file?.id) continue;
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
        merged.title = existing.title || merged.title;
        byId.set(file.id, { ...existing, ...merged });
      } else {
        byId.set(file.id, merged);
      }
    }
  }

  return {
    ingest,
    values: () => [...byId.values()],
  };
}

/**
 * Run a pre-built fan-out plan and merge recordings by normalized id.
 *
 * @param {{
 *   fetchVariant: (
 *     params: Record<string, string>,
 *     opts: Record<string, number>
 *   ) => Promise<Array<NonNullable<ReturnType<typeof normalizePlaudRecording>>>>;
 *   plan: ReturnType<typeof buildPlaudRecordingFanoutPlan>;
 *   onVariantError?: (
 *     error: unknown,
 *     step: ReturnType<typeof buildPlaudRecordingFanoutPlan>[number]
 *   ) => void;
 * }} options
 */
export async function runPlaudRecordingFanout(options) {
  const ingestor = createPlaudRecordingIngestor();
  for (const step of options.plan) {
    try {
      ingestor.ingest(
        await options.fetchVariant(step.params, step.opts || {}),
        step.contextFolderId
      );
    } catch (err) {
      if (options.onVariantError) {
        options.onVariantError(err, step);
      } else {
        throw err;
      }
    }
  }
  return ingestor.values();
}
