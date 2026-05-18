/**
 * Direct internal Plaud API client. Mirrors the behavior of the extension's
 * `features/audioExport/audioExport.js` so that anyone reading the extension
 * sees the same endpoints, headers, retry policy, and -302 region switch.
 *
 * The client deliberately:
 *  - uses Node global `fetch` (>= Node 20)
 *  - never reads or writes browser storage
 *  - never retries 401/403 (the only useful recovery is re-auth)
 *  - keeps secrets out of any thrown Error message
 */
import { config } from "../config/config.js";
import {
  buildTagByIdMap,
  collectUnfiledFiletagIds,
  extractFiletagIdsFromRaw,
  mergeFiletagIds,
  mergeFiletagsById,
  parseFiletagListPayload,
  resolveFolderPathSegment,
} from "./plaudFolders.js";

const PLAUD_API_FALLBACK = "https://api.plaud.ai";

export class PlaudAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PlaudAuthError";
    this.status = status;
  }
}

export class PlaudChangedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PlaudChangedError";
    this.details = details;
  }
}

function buildPlaudHeaders(session, extra = {}) {
  const webOrigin = config.plaudWebOrigin;
  const headers = {
    Authorization: session.authHeader,
    "edit-from": "web",
    "app-platform": "web",
    "Content-Type": "application/json",
    // Plaud's API sits behind Cloudflare; bare Node fetch gets HTML 403 without
    // browser-like Origin/Referer/User-Agent (misread as "session expired").
    Origin: webOrigin,
    Referer: `${webOrigin}/`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...extra,
  };
  if (session.workspaceId) headers["workspace-id"] = session.workspaceId;
  return headers;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
}

function normalizeApiBase(rawBase) {
  const parsed = typeof rawBase === "object" && rawBase ? rawBase.domain : rawBase;
  if (!parsed || typeof parsed !== "string") return PLAUD_API_FALLBACK;
  try {
    const withProtocol = parsed.startsWith("http") ? parsed : `https://${parsed}`;
    const url = new URL(withProtocol);
    if (!url.hostname.endsWith(".plaud.ai")) return PLAUD_API_FALLBACK;
    return url.origin;
  } catch {
    return PLAUD_API_FALLBACK;
  }
}

async function fetchPlaudApiOnce(session, path, options = {}) {
  const { retryDomainSwitch = true, headers = {}, method = "GET" } = options;
  const url = new URL(path, session.apiBase);
  let response;
  try {
    response = await fetchWithTimeout(
      url.toString(),
      { method, headers: buildPlaudHeaders(session, headers) },
      config.apiTimeoutMs
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Plaud API timeout (${config.apiTimeoutMs} ms)`);
    }
    throw error;
  }

  const payload = await response.json().catch(() => null);

  if (retryDomainSwitch && payload?.status === -302 && payload?.data?.domains?.api) {
    session.apiBase = normalizeApiBase(payload.data.domains.api);
    return fetchPlaudApiOnce(session, path, { ...options, retryDomainSwitch: false });
  }

  if (response.status === 401 || response.status === 403) {
    throw new PlaudAuthError(
      `Plaud API auth failed (HTTP ${response.status}); session likely expired.`,
      response.status
    );
  }

  if (!response.ok) {
    throw new Error(`Plaud API HTTP ${response.status}`);
  }

  if (typeof payload?.status === "number" && payload.status < 0) {
    throw new Error(payload?.message || `Plaud API returned status ${payload.status}`);
  }

  return payload;
}

function shouldRetryFetchAttempt(error) {
  if (error instanceof PlaudAuthError) return false;
  const msg = String(error?.message || error || "");
  if (/\bHTTP\s+401\b/.test(msg) || /\bHTTP\s+403\b/.test(msg)) return false;
  if (error?.name === "AbortError") return true;
  if (/Plaud API timeout/i.test(msg)) return true;
  if (/\bHTTP\s+(429|502|503|504)\b/.test(msg)) return true;
  if (
    /Failed to fetch/i.test(msg) ||
    /NetworkError/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)
  ) {
    return true;
  }
  return false;
}

export async function fetchPlaudApi(session, path, options = {}) {
  let lastError;
  const max = config.apiMaxRetries;
  for (let attempt = 0; attempt < max; attempt++) {
    if (attempt > 0) await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    try {
      return await fetchPlaudApiOnce(session, path, options);
    } catch (error) {
      lastError = error;
      if (!shouldRetryFetchAttempt(error) || attempt >= max - 1) throw error;
    }
  }
  throw lastError;
}

export async function fetchUrlTextWithRetries(url) {
  let lastError;
  const max = config.apiMaxRetries;
  for (let attempt = 0; attempt < max; attempt++) {
    if (attempt > 0) await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    try {
      const response = await fetchWithTimeout(url, {}, config.apiTimeoutMs);
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status} when fetching summary body`);
        if (![429, 502, 503, 504].includes(response.status) || attempt >= max - 1) {
          throw err;
        }
        lastError = err;
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (!shouldRetryFetchAttempt(error) || attempt >= max - 1) throw error;
    }
  }
  throw lastError;
}

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

const TITLE_KEYS = [
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

const SUMMARY_NOTE_TYPES = new Set([
  "summary",
  "auto_sum_note",
  "sum_multi_note",
]);

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

function normalizeHumanTitle(value) {
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

    let done = false;
    if (serverTotal != null) {
      done = rawLen === 0 || (skip + rawLen >= serverTotal && rawLen < pageLimit);
    } else {
      done = rawLen === 0 || rawLen < pageLimit;
    }
    if (done) break;
  }

  return files;
}

function attachFolderSegments(files, tagById, unfiledIds) {
  if (!config.mirrorFolders) return files;
  for (const file of files) {
    file.folderSegment = resolveFolderPathSegment(
      file.folderIds,
      tagById,
      unfiledIds
    );
  }
  return files;
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

  return [...byId.values()];
}

/**
 * Full workspace list: global pulls plus per-folder passes (extension parity).
 * When PLAUD_MIRROR_FOLDERS=false, only the global non-trash list is fetched.
 */
export async function listAllRecordings(session, options = {}) {
  const { includeTrash = false, sortBy = session.sortBy } = options;

  if (!config.mirrorFolders) {
    return listAllRecordingsSimple(session, options);
  }

  let tags = [];
  try {
    tags = await fetchPlaudFiletagList(session);
  } catch {
    tags = [];
  }
  const tagById = buildTagByIdMap(tags);
  const unfiledIds = new Set(collectUnfiledFiletagIds(tags));
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

  return attachFolderSegments([...byId.values()], tagById, unfiledIds);
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

function getArrayCandidates(payload) {
  return [
    payload?.data,
    payload?.data?.data,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data?.note_list,
    payload?.data_note_result,
    payload?.note_list,
    payload?.list,
    payload?.items,
  ].filter(Array.isArray);
}

function isSummaryLikeNote(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const noteType = value.data_type || value.note_type || value.type;
  return SUMMARY_NOTE_TYPES.has(noteType);
}

function findSummaryNotes(payload) {
  const direct = getArrayCandidates(payload).flat().filter(isSummaryLikeNote);
  if (direct.length) return direct;
  const out = [];
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (isSummaryLikeNote(value)) out.push(value);
    Object.values(value).forEach(walk);
  }
  walk(payload);
  return out;
}

/**
 * Plaud summaries occasionally embed Markdown image references to assets the
 * Plaud webapp serves from its own CDN (e.g. `![PLAUD NOTE](permanent/<hash>/
 * .../summary_poster/card_*.png)`). Those paths are relative to Plaud's site,
 * so they show up as broken images inside Obsidian. We strip them out of the
 * summary body before persisting anything.
 */
const PLAUD_INLINE_ASSET_RE =
  /!\[[^\]]*\]\(\s*(?:<\s*)?(?:permanent\/[^)\s>]*|[^)\s>]*summary_poster\/[^)\s>]*)(?:\s*>)?\s*\)/g;

export function stripPlaudInlineAssets(markdown) {
  if (typeof markdown !== "string" || !markdown) return markdown || "";
  return markdown
    .replace(PLAUD_INLINE_ASSET_RE, "")
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

function parseSummaryContent(rawContent) {
  if (rawContent == null) return "";
  if (typeof rawContent === "string") {
    const trimmed = rawContent.trim();
    if (!trimmed) return "";
    try {
      return parseSummaryContent(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (Array.isArray(rawContent)) {
    return rawContent.map(parseSummaryContent).filter(Boolean).join("\n\n");
  }
  if (typeof rawContent === "object") {
    const directContent =
      rawContent.ai_content ||
      rawContent.content ||
      rawContent.summary ||
      rawContent.text ||
      rawContent.note_content;
    if (directContent != null) return parseSummaryContent(directContent);
    const sectionParts = Object.entries(rawContent)
      .filter(([key, value]) => {
        if (value == null || key === "summary_id") return false;
        return typeof value === "string" || Array.isArray(value);
      })
      .map(([key, value]) => {
        const parsed = parseSummaryContent(value);
        return parsed ? `## ${key}\n${parsed}` : "";
      })
      .filter(Boolean);
    return sectionParts.join("\n\n");
  }
  return String(rawContent).trim();
}

async function getNoteRawContent(note) {
  if (note.data_content) return note.data_content;
  if (note.note_content) return note.note_content;
  if (!note.data_link) return "";
  return fetchUrlTextWithRetries(note.data_link);
}

function getSummaryNoteTitle(note) {
  return (
    note.data_title ||
    note.data_tab_name ||
    note.note_title ||
    note.tab_name ||
    note.note_type ||
    note.data_type ||
    "Summary"
  );
}

/**
 * @returns {Promise<Array<{ title: string; markdown: string }>>}
 */
export async function fetchSummaries(session, file) {
  const payload = await fetchPlaudApi(session, "/ai/query_note", {
    headers: { "file-id": file.id },
  });
  const notes = findSummaryNotes(payload);
  if (!notes.length && payload && typeof payload === "object") {
    if (Array.isArray(payload.data) && payload.data.length === 0) {
      return [];
    }
    const hasData = payload.data != null || payload.status != null;
    if (hasData) {
      throw new PlaudChangedError(
        "Plaud summary response has an unexpected shape; no summary notes found.",
        { endpoint: "/ai/query_note", fileId: file.id }
      );
    }
  }
  const summaries = [];
  for (const note of notes) {
    const raw = await getNoteRawContent(note);
    const content = stripPlaudInlineAssets(parseSummaryContent(raw)).trim();
    if (!content) continue;
    const title = normalizeHumanTitle(getSummaryNoteTitle(note)) || "Summary";
    const body = /^\s{0,3}#{1,6}\s/m.test(content)
      ? `${content}\n`
      : `# ${normalizeHumanTitle(file.title) || title}\n\n${content}\n`;
    summaries.push({ title, markdown: body });
  }
  return summaries;
}

function looksLikeDownloadUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  return (
    /\.(mp3|m4a|wav|opus|ogg|aac|mp4)([?#].*)?$/i.test(value) ||
    /audio|resource|download|file|object|presign|temp/i.test(value)
  );
}

function extractDownloadUrl(payload) {
  const urls = [];
  const seen = new Set();
  function walk(value) {
    if (value == null || seen.has(value)) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    Object.values(value).forEach(walk);
  }
  walk(payload);
  return urls.find(looksLikeDownloadUrl) || urls[0] || "";
}

function extractTitleHintForFile(payload, fileId) {
  const wantId = String(fileId || "").toLowerCase();
  let best = "";
  const seen = new Set();
  function walk(value, depth = 0) {
    if (depth > 14 || value == null) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    const o = value;
    const oid = String(o.file_id || o.fileId || o.id || "").trim().toLowerCase();
    const idMatches = !wantId || !oid || oid === wantId || oid.includes(wantId) || wantId.includes(oid);
    for (const key of TITLE_KEYS) {
      if (typeof o[key] !== "string") continue;
      const t = normalizeHumanTitle(o[key]);
      if (!t || t.length > 400) continue;
      if (wantId && oid && !idMatches) continue;
      if (t.length > best.length) best = t;
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  }
  walk(payload);
  return best;
}

/**
 * @returns {Promise<{ url: string; titleHint: string }>}
 */
export async function fetchAudioUrl(session, fileId) {
  const payload = await fetchPlaudApi(
    session,
    `/file/temp-url/${encodeURIComponent(fileId)}`
  );
  const url = extractDownloadUrl(payload);
  if (!url) throw new Error(`No audio URL returned for file ${fileId}`);
  return { url, titleHint: extractTitleHintForFile(payload, fileId) };
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
