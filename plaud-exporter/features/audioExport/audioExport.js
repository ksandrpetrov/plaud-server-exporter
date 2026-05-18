/**
 * features/audioExport/audioExport.js
 */
import {
  createStatusIndicator,
  updateIndicator,
} from "../../common/uiComponents.js";
import {
  RAW_FILE_ID_RE,
  normalizeHexRecordingId,
  collectDomRecordingHexIds,
} from "../../common/plaudRecordingIds.js";
import {
  AUDIO_SUBDIRECTORY,
  DEFAULT_SYNC_SUBDIRECTORY,
  SUMMARY_SUBDIRECTORY,
  extractTitleFromMarkdown,
  normalizeFilename,
  sanitizePathSegment,
} from "../../common/exportPathUtils.js";
import {
  buildRelativeArtifactPath,
  buildStableId,
  detectDuplicate,
  determineSyncAction,
  hashStringSync,
  hashSummary,
  sanitizeSyncSubdirectory,
  SYNC_ACTION_ALREADY_SYNCED,
  SYNC_ACTION_NEW,
  SYNC_ACTION_SKIPPED,
  SYNC_ACTION_UPDATED,
  SYNC_STATUS_ERROR,
  SYNC_STATUS_SKIPPED,
  SYNC_STATUS_SUCCESS,
  SYNC_STATUS_UPDATED,
  updateExistingRecord,
} from "../../common/syncCore.js";
import { loadSyncIndex, saveSyncIndex } from "../../common/storageUtils.js";
import { runDomExportFallback } from "./domExportFallback.js";

const PLAUD_API_FALLBACK = "https://api.plaud.ai";
const PLAUD_API_PAGE_LIMIT = 100;
const PLAUD_API_MAX_FILES = 5000;
const EXPORT_MODE_BOTH = "both";
const EXPORT_MODE_AUDIO = "audio";
const EXPORT_MODE_SUMMARY = "summary";
const EXPORT_MODES = new Set([
  EXPORT_MODE_BOTH,
  EXPORT_MODE_AUDIO,
  EXPORT_MODE_SUMMARY,
]);
const SUMMARY_NOTE_TYPES = new Set([
  "summary",
  "auto_sum_note",
  "sum_multi_note",
]);
/** Поля в JSON Plaud, откуда берётся человекочитаемое имя записи */
const PLAUD_TITLE_KEYS = new Set([
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
]);

function parseStoredValue(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeBearerToken(token) {
  if (!token) return "";
  const parsedToken = parseStoredValue(token);
  const tokenString = String(parsedToken || "").trim();
  if (!tokenString) return "";
  return tokenString.toLowerCase().startsWith("bearer ")
    ? tokenString
    : `Bearer ${tokenString}`;
}

function decodeJwtSubject(token) {
  try {
    const tokenString = String(parseStoredValue(token) || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const parts = tokenString.split(".");
    if (parts.length !== 3) return "";
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = normalizedPayload.padEnd(
      Math.ceil(normalizedPayload.length / 4) * 4,
      "="
    );
    const decoded = JSON.parse(atob(payload));
    return decoded.sub || "";
  } catch {
    return "";
  }
}

function getScopedStorageValue(key) {
  return parseStoredValue(localStorage.getItem(key));
}

function normalizeExportMode(mode) {
  return EXPORT_MODES.has(mode) ? mode : EXPORT_MODE_BOTH;
}

function getExportModeLabel(mode) {
  if (mode === EXPORT_MODE_AUDIO) return "аудио";
  if (mode === EXPORT_MODE_SUMMARY) return "саммари";
  return "аудио и саммари";
}

function normalizeApiBase(rawBase) {
  const parsedBase =
    typeof rawBase === "object" && rawBase ? rawBase.domain : rawBase;
  if (!parsedBase || typeof parsedBase !== "string") return PLAUD_API_FALLBACK;

  try {
    const withProtocol = parsedBase.startsWith("http")
      ? parsedBase
      : `https://${parsedBase}`;
    const url = new URL(withProtocol);
    if (!url.hostname.endsWith(".plaud.ai")) return PLAUD_API_FALLBACK;
    return url.origin;
  } catch {
    return PLAUD_API_FALLBACK;
  }
}

function getPlaudApiBase(userId) {
  const userScopedBase = userId
    ? getScopedStorageValue(`pld_${userId}:plaud_user_api_domain`)
    : null;
  const globalBase = getScopedStorageValue("plaud_user_api_domain");
  return normalizeApiBase(userScopedBase || globalBase || PLAUD_API_FALLBACK);
}

function getPlaudSession() {
  const userToken =
    getScopedStorageValue("pld_tokenstr") || getScopedStorageValue("tokenstr");
  const userId = decodeJwtSubject(userToken);
  const workspaceId = userId
    ? getScopedStorageValue(`pld_${userId}:currentWorkspaceId`)
    : null;
  const workspaceList = userId
    ? getScopedStorageValue(`pld_${userId}:workspaceList`)
    : null;
  const currentWorkspace = Array.isArray(workspaceList)
    ? workspaceList.find((workspace) => workspace.workspaceId === workspaceId)
    : null;
  const nowMs = Date.now();
  const ws = currentWorkspace;
  /** Workspace JWT: как в UI, если нет expiresAt — доверяем токену; иначе проверяем срок (секунды или мс). */
  let workspaceTokenRaw = "";
  if (ws?.workspaceToken) {
    const exp = ws.expiresAt;
    if (exp == null || exp === "") {
      workspaceTokenRaw = ws.workspaceToken;
    } else {
      let n = Number(exp);
      if (Number.isFinite(n)) {
        if (n < 1e12) n *= 1000;
        if (n > nowMs) workspaceTokenRaw = ws.workspaceToken;
      }
    }
  }
  const userAuthHeader = normalizeBearerToken(userToken);
  const workspaceAuthHeader = normalizeBearerToken(workspaceTokenRaw);
  const authHeader = workspaceAuthHeader || userAuthHeader;

  if (!authHeader) {
    throw new Error("Не удалось прочитать токен авторизации Plaud. Войдите в аккаунт.");
  }

  const sortBy =
    userId && workspaceId
      ? getScopedStorageValue(`pld_${userId}_${workspaceId}:sort_by`)
      : null;

  return {
    apiBase: getPlaudApiBase(userId),
    authHeader,
    userAuthHeader,
    workspaceAuthHeader,
    workspaceId:
      workspaceId != null && String(workspaceId).trim()
        ? String(workspaceId).trim()
        : "",
    sortBy:
      typeof sortBy === "string" && sortBy.trim() ? sortBy : "start_time",
  };
}

function buildPlaudHeaders(session, extraHeaders = {}) {
  const headers = {
    Authorization: session.authHeader,
    "edit-from": "web",
    "app-platform": "web",
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (session.workspaceId) {
    headers["workspace-id"] = session.workspaceId;
  }
  return headers;
}

const PLAUD_FETCH_TIMEOUT_MS = 45000;
const PLAUD_FETCH_MAX_RETRIES = 3;

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

async function fetchPlaudApiOnce(session, path, options = {}) {
  const {
    retryDomainSwitch = true,
    headers = {},
    method = "GET",
  } = options;
  const url = new URL(path, session.apiBase);
  let response;
  try {
    response = await fetchWithTimeout(
      url.toString(),
      {
        method,
        headers: buildPlaudHeaders(session, headers),
      },
      PLAUD_FETCH_TIMEOUT_MS
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Таймаут запроса к API Plaud (${PLAUD_FETCH_TIMEOUT_MS} мс)`
      );
    }
    throw error;
  }
  const payload = await response.json().catch(() => null);

  if (
    retryDomainSwitch &&
    payload?.status === -302 &&
    payload?.data?.domains?.api
  ) {
    session.apiBase = normalizeApiBase(payload.data.domains.api);
    return fetchPlaudApiOnce(session, path, {
      ...options,
      retryDomainSwitch: false,
    });
  }

  if (!response.ok) {
    throw new Error(`Ошибка запроса к API Plaud: HTTP ${response.status}`);
  }

  if (typeof payload?.status === "number" && payload.status < 0) {
    throw new Error(
      payload?.message || `API Plaud вернул статус ${payload.status}`
    );
  }

  return payload;
}

function shouldRetryPlaudFetchAttempt(error, httpStatusFromMessage) {
  const msg = String(error?.message || error || "");
  if (/\bHTTP\s+401\b/.test(msg) || /\bHTTP\s+403\b/.test(msg)) {
    return false;
  }
  if (error?.name === "AbortError") return true;
  if (/таймаут запроса к API Plaud/i.test(msg)) return true;
  if (
    /\bHTTP\s+429\b/.test(msg) ||
    /\bHTTP\s+502\b/.test(msg) ||
    /\bHTTP\s+503\b/.test(msg) ||
    /\bHTTP\s+504\b/.test(msg)
  ) {
    return true;
  }
  if (
    /Failed to fetch/i.test(msg) ||
    /NetworkError/i.test(msg) ||
    /network request failed/i.test(msg) ||
    /Load failed/i.test(msg)
  ) {
    return true;
  }
  if (
    httpStatusFromMessage &&
    [429, 502, 503, 504].includes(httpStatusFromMessage)
  ) {
    return true;
  }
  return false;
}

async function fetchPlaudApi(session, path, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < PLAUD_FETCH_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    }
    try {
      return await fetchPlaudApiOnce(session, path, options);
    } catch (error) {
      lastError = error;
      const m = String(error?.message || "");
      const httpMatch = m.match(/HTTP\s+(\d+)/i);
      const statusNum = httpMatch ? Number(httpMatch[1]) : NaN;
      if (!shouldRetryPlaudFetchAttempt(error, statusNum)) {
        throw error;
      }
      if (attempt >= PLAUD_FETCH_MAX_RETRIES - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function fetchUrlTextWithRetries(url) {
  let lastError;
  for (let attempt = 0; attempt < PLAUD_FETCH_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    }
    try {
      const response = await fetchWithTimeout(
        url,
        {},
        PLAUD_FETCH_TIMEOUT_MS
      );
      if (!response.ok) {
        const err = new Error(
          `Не удалось загрузить саммари: HTTP ${response.status}`
        );
        if (
          ![429, 502, 503, 504].includes(response.status) ||
          attempt >= PLAUD_FETCH_MAX_RETRIES - 1
        ) {
          throw err;
        }
        lastError = err;
        continue;
      }
      return response.text();
    } catch (error) {
      lastError = error;
      if (!shouldRetryPlaudFetchAttempt(error, NaN)) {
        throw error;
      }
      if (attempt >= PLAUD_FETCH_MAX_RETRIES - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

/** Единый идентификатор записи из объекта ответа `/file/simple/web`. */
function extractRawRecordingId(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const keys = [
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
  for (const k of keys) {
    const v = raw[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function isFileLikeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const id = extractRawRecordingId(value);
  return id.length > 0;
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
      const extracted = extractRawRecordingId(raw);
      let id = normalizeHexRecordingId(extracted);
      if (!id && extracted) id = String(extracted).trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, raw);
    }
  }
  return [...byId.values()];
}

function isFiletagLikeObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const id = v.id ?? v.filetag_id ?? v.tag_id ?? v.folder_id;
  return !!(id != null && String(id).trim());
}

function collectQualifyingFiletagArrays(payload) {
  const collected = [];

  function pushIfQualifies(candidate) {
    if (!Array.isArray(candidate) || candidate.length === 0) return;
    if (!candidate.some(isFiletagLikeObject)) return;
    collected.push(candidate);
  }

  const directCandidates = [
    payload?.data?.data_filetag_list,
    payload?.data?.filetag_list,
    payload?.data?.tags,
    payload?.data?.folders,
    payload?.data?.folder_list,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data_filetag_list,
    payload?.filetag_list,
    payload?.tags,
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

/** Все виртуальные папки из ответа `/filetag/` — объединяем несколько массивов и дедуплим по id. */
function findFiletagArray(payload) {
  const arrays = collectQualifyingFiletagArrays(payload);
  const byId = new Map();
  for (const arr of arrays) {
    for (const t of arr) {
      if (!isFiletagLikeObject(t)) continue;
      const id = String(t.id ?? t.filetag_id ?? t.tag_id ?? t.folder_id).trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, t);
    }
  }
  return [...byId.values()];
}

/**
 * Все виртуальные папки «Unfiled» из `/filetag/` (иногда несколько совпадающих записей).
 */
function collectUnfiledFiletagIds(tags) {
  const ids = new Set();
  /** @param {object} t */
  function addFromTag(t) {
    const id = t?.id ?? t?.filetag_id ?? t?.tag_id ?? t?.folder_id;
    if (id != null && String(id).trim()) ids.add(String(id).trim());
  }

  if (!Array.isArray(tags)) return [];

  for (const t of tags) {
    if (!t || typeof t !== "object") continue;
    if (
      t.is_unfiled === true ||
      t.unfiled === true ||
      t.is_unclassified === true ||
      t.is_untagged === true ||
      t.unclassified === true ||
      t.is_inbox === true
    ) {
      addFromTag(t);
    }
  }

  for (const t of tags) {
    if (!t || typeof t !== "object") continue;
    const sysKind = String(
      t.system_folder_type ??
        t.sys_folder_type ??
        t.folder_kind ??
        t.tag_kind ??
        ""
    ).toLowerCase();
    if (
      sysKind.includes("unfile") ||
      sysKind.includes("inbox") ||
      sysKind.includes("untagged")
    ) {
      addFromTag(t);
    }
  }

  const namePatterns = [
    /unfiled/i,
    /^untagged$/i,
    /^inbox$/i,
    /^без\s*папки$/i,
    /^без\s*категори/i,
    /^без\s*тег/i,
    /^несортирован/i,
    /^не\s*разобран/i,
    /uncategorized/i,
    /^sin\s+carpeta$/i,
    /^ohne\s+ordner$/i,
    /^未分类$/,
    /^未归档$/,
  ];

  for (const t of tags) {
    if (!t || typeof t !== "object") continue;
    const name = String(
      t.name ?? t.tag_name ?? t.title ?? t.folder_name ?? ""
    ).trim();
    if (!name) continue;
    if (namePatterns.some((re) => re.test(name))) {
      addFromTag(t);
    }
  }

  for (const t of tags) {
    if (!t || typeof t !== "object") continue;
    const typ = String(t.type ?? t.tag_type ?? "").toLowerCase();
    if (
      typ.includes("unfile") ||
      typ.includes("untagged") ||
      typ.includes("inbox")
    ) {
      addFromTag(t);
    }
  }

  return [...ids];
}

function mergeFiletagsById(tagArrays) {
  const byId = new Map();
  for (const tags of tagArrays) {
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (!isFiletagLikeObject(t)) continue;
      const id = String(t.id ?? t.filetag_id ?? t.tag_id ?? t.folder_id).trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, t);
    }
  }
  return [...byId.values()];
}

async function fetchPlaudFiletagListWithAuth(session, authHeader) {
  const h = authHeader || session.authHeader;
  const reqHeaders = { Authorization: h };
  try {
    const payload = await fetchPlaudApi(session, "/filetag/", {
      headers: reqHeaders,
    });
    return findFiletagArray(payload);
  } catch {
    const payload = await fetchPlaudApi(session, "/filetag", {
      headers: reqHeaders,
    });
    return findFiletagArray(payload);
  }
}

async function fetchPlaudFiletagList(session) {
  const ua = session.userAuthHeader || "";
  const wa = session.workspaceAuthHeader || "";
  const buckets = [];
  let userTags = [];
  try {
    userTags = await fetchPlaudFiletagListWithAuth(session, ua);
  } catch {
    userTags = [];
  }
  buckets.push(userTags);
  if (wa && wa !== ua) {
    try {
      buckets.push(await fetchPlaudFiletagListWithAuth(session, wa));
    } catch {
      // ignore
    }
  }
  const merged = mergeFiletagsById(buckets);
  return merged;
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

function isPlausibleRecordingTitle(text) {
  const s = String(text || "").trim();
  if (!s || s.length > 400) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (RAW_FILE_ID_RE.test(s)) return false;
  return true;
}

/**
 * Ищет в ответе API (в т.ч. /file/temp-url) строку с именем записи для fileId.
 */
function extractTitleForFileFromPayload(payload, fileId) {
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
    const oid = String(o.file_id || o.fileId || o.id || "")
      .trim()
      .toLowerCase();
    const idMatches =
      !wantId ||
      !oid ||
      oid === wantId ||
      oid.includes(wantId) ||
      wantId.includes(oid);

    for (const key of PLAUD_TITLE_KEYS) {
      if (typeof o[key] !== "string") continue;
      const t = normalizeHumanTitle(o[key]);
      if (!isPlausibleRecordingTitle(t)) continue;
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

function titleLooksLikeRawId(title, fileId) {
  const t = normalizeHumanTitle(title);
  const id = String(fileId || "").trim();
  if (!t || t === id) return true;
  if (RAW_FILE_ID_RE.test(t)) return true;
  return false;
}

function preferApiTitle(file, titleHint) {
  const hint = normalizeHumanTitle(titleHint);
  if (!hint || !isPlausibleRecordingTitle(hint)) return file;
  if (titleLooksLikeRawId(file.title, file.id)) {
    return { ...file, title: hint };
  }
  const current = normalizeHumanTitle(file.title);
  if (hint.length >= current.length + 3) {
    return { ...file, title: hint };
  }
  return file;
}

function normalizePlaudFile(rawFile) {
  const extracted = extractRawRecordingId(rawFile);
  let id = normalizeHexRecordingId(extracted);
  if (!id && extracted) id = String(extracted).trim();
  const rawTitle =
    rawFile.file_name ||
    rawFile.filename ||
    rawFile.fileName ||
    rawFile.file_title ||
    rawFile.fileTitle ||
    rawFile.display_name ||
    rawFile.displayName ||
    rawFile.audio_name ||
    rawFile.recording_name ||
    rawFile.recordingTitle ||
    rawFile.topic ||
    rawFile.name ||
    rawFile.title;
  const title = normalizeHumanTitle(rawTitle) || String(id);

  if (!id) return null;

  return {
    id,
    title: title || String(id),
    raw: rawFile,
  };
}

/** @returns {{ trashy: number; likelyLive: number; unclear: number }} */
function countRecordingTrashSignals(files) {
  let trashy = 0;
  let likelyLive = 0;
  let unclear = 0;
  for (const f of files) {
    const raw = f?.raw;
    if (!raw || typeof raw !== "object") {
      unclear++;
      continue;
    }
    const v = raw.is_trash ?? raw.isTrash ?? raw.in_trash ?? raw.trashed;
    if (v === true || v === 1 || v === "1") trashy++;
    else if (v === false || v === 0 || v === "0") likelyLive++;
    else unclear++;
  }
  return { trashy, likelyLive, unclear };
}

/** Есть ли саммари по полям строки списка `/file/simple/web` (без `/ai/query_note`). */
function rawIndicatesLikelySummary(raw) {
  if (!raw || typeof raw !== "object") return false;
  const yes = (v) => v === true || v === 1 || v === "1";
  if (
    yes(raw.has_summary) ||
    yes(raw.is_summary) ||
    yes(raw.hasSummary) ||
    yes(raw.isSummary) ||
    yes(raw.is_sum)
  ) {
    return true;
  }
  const n = Number(
    raw.summary_count ??
      raw.summary_num ??
      raw.sum_note_count ??
      raw.ai_note_count
  );
  return Number.isFinite(n) && n > 0;
}

function countLikelySummariesFromFileMetadata(files) {
  let n = 0;
  for (const f of files) {
    if (rawIndicatesLikelySummary(f?.raw)) n++;
  }
  return n;
}

async function fetchPlaudFilesOneListVariant(session, fixedParams, opts = {}) {
  const maxPagesRaw = Number(opts.maxPages);
  const maxPages =
    Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? maxPagesRaw : Infinity;

  const limitOverride = Number(opts.limitOverride);
  const pageLimit =
    Number.isFinite(limitOverride) &&
    limitOverride > 0 &&
    limitOverride <= PLAUD_API_MAX_FILES
      ? Math.floor(limitOverride)
      : PLAUD_API_PAGE_LIMIT;

  const files = [];
  const seenIds = new Set();
  let pagesFetched = 0;

  for (let skip = 0; skip < PLAUD_API_MAX_FILES; skip += pageLimit) {
    const query = new URLSearchParams({
      skip: String(skip),
      limit: String(pageLimit),
      sort_by: session.sortBy,
      is_desc: "true",
      r: String(Math.random()),
      ...fixedParams,
    });
    const payload = await fetchPlaudApi(
      session,
      `/file/simple/web?${query.toString()}`
    );
    const arrays = collectQualifyingFileArrays(payload);
    const rawLen = arrays.length
      ? Math.max(...arrays.map((a) => a.length))
      : 0;
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
    if (pagesFetched >= maxPages) {
      break;
    }

    let done = false;
    // Не завершаем по serverTotal при полной странице: часть ответов Plaud даёт total,
    // совпадающий с размером первой страницы — из‑за этого обрывалась пагинация и терялись
    // хвосты списков (в т.ч. «невидимые» для глобального запроса записи).
    if (serverTotal != null) {
      done =
        rawLen === 0 ||
        (skip + rawLen >= serverTotal && rawLen < pageLimit);
    } else {
      done = rawLen === 0 || rawLen < pageLimit;
    }
    if (done) {
      break;
    }
  }

  return files;
}

function isTrashSidebarTag(tag) {
  if (!tag || typeof tag !== "object") return false;
  const name = String(tag.name ?? tag.tag_name ?? "").toLowerCase();
  return /\btrash\b|\brecycle\b|корзина/i.test(name);
}

/**
 * Полный список записей workspace: активные + корзина + обход папок (включая Unfiled).
 * На странице Plaud Web prefetch вызывает `/file/simple/web` с **is_trash=2** (не 0 и не пустой query).
 */
async function fetchPlaudFilesFromApi(session) {
  const byId = new Map();

  function ingest(list) {
    for (const file of list) {
      const k =
        normalizeHexRecordingId(file?.id) ||
        String(file?.id || "")
          .trim()
          .toLowerCase();
      if (k) byId.set(k, file);
    }
  }

  async function tryIngest(params, opts) {
    try {
      ingest(
        await fetchPlaudFilesOneListVariant(session, params, opts || {})
      );
    } catch {
      // часть параметров может быть недоступна на части сборок API
    }
  }

  /** Как неофициальный клиент Plaud: один запрос с большим limit + is_trash=0 (см. arbuzmell/plaud-api). */
  async function tryMegaPull(params) {
    await tryIngest(params, { maxPages: 1, limitOverride: PLAUD_API_MAX_FILES });
  }
  await tryMegaPull({ is_trash: "0" });
  await tryMegaPull({ is_trash: "2" });

  const liveVariants = [{ is_trash: "0" }, { is_trash: "2" }, {}];
  for (const params of liveVariants) {
    await tryIngest(params);
  }

  await tryIngest({ is_trash: "1" });

  let tags = [];
  try {
    tags = await fetchPlaudFiletagList(session);
  } catch {
    tags = [];
  }

  const unfiledIds = collectUnfiledFiletagIds(tags);
  const unfiledIdSet = new Set(unfiledIds);

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

  for (const s of ["0", "-1", "-2"]) {
    await tryIngest({ is_trash: "2", tag_id: s }, { maxPages: 20 });
    await tryIngest({ is_trash: "2", folder_id: s }, { maxPages: 20 });
  }

  const folderIds = new Set();
  for (const uid of unfiledIds) folderIds.add(uid);

  for (const t of tags) {
    if (!t || typeof t !== "object") continue;
    if (isTrashSidebarTag(t)) continue;
    const tid = t.id ?? t.filetag_id ?? t.tag_id ?? t.folder_id;
    if (tid == null || !String(tid).trim()) continue;
    folderIds.add(String(tid).trim());
  }

  const MAX_FOLDER_PULLS = 400;
  let pulls = 0;
  for (const fid of folderIds) {
    if (pulls >= MAX_FOLDER_PULLS) break;
    pulls++;
    await tryIngest({ is_trash: "2", filetag_id: fid }, { maxPages: 80 });
    if (unfiledIdSet.has(fid)) {
      await tryIngest({ filetag_id: fid }, { maxPages: 80 });
    }
  }

  await tryIngest({ is_trash: "2", filetag_id: "-1" }, { maxPages: 15 });
  await tryIngest({ filetag_id: "-1" }, { maxPages: 15 });

  return Array.from(byId.values());
}

/** Дополняет список записями, чьи id есть в DOM (видимые строки списка / ссылки), но не пришли из API. */
function mergeDomRecordingIdsIntoFiles(files) {
  const domIds = collectDomRecordingHexIds();
  const seenIds = new Set(
    files.map((f) => normalizeHexRecordingId(f.id) || String(f.id || "").toLowerCase())
  );
  let domMerged = 0;
  for (const hid of domIds) {
    const id = String(hid).toLowerCase();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    files.push({
      id,
      title: id,
      raw: { file_id: id },
    });
    domMerged++;
  }
  return { domMerged, domSeen: domIds.length };
}

/** Объект из кэша Plaud в storage — по полям похож на метаданные записи (в т.ч. «обрезанный» кэш). */
function looksLikeCachedRecordingRow(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const id = normalizeHexRecordingId(extractRawRecordingId(o));
  if (!id) return false;

  const keys = Object.keys(o);
  if (
    keys.length <= 3 &&
    keys.every((k) => /^(id|file_id|fileId|fileID)$/i.test(k))
  ) {
    return false;
  }

  return keys.some((k) =>
    /file|record|audio|note|summary|transcript|duration|time|trash|tag|folder|upload|title|name|topic|display|workspace/i.test(
      k
    )
  );
}

function collectRecordingIdsFromPlaudWebStorage(storage, maxKeys) {
  if (storage == null || typeof storage.key !== "function") return [];

  const ids = new Set();
  const visited = new WeakSet();

  function walk(value, depth) {
    if (depth > 18 || value == null) return;
    if (typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }

    if (looksLikeCachedRecordingRow(value)) {
      const nid = normalizeHexRecordingId(extractRawRecordingId(value));
      if (nid) ids.add(nid);
    }

    for (const v of Object.values(value)) walk(v, depth + 1);
  }

  let scannedKeys = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.includes("pld")) continue;
      scannedKeys++;
      if (scannedKeys > maxKeys) break;

      const raw = storage.getItem(key);
      if (!raw || raw.length > 3_500_000) continue;
      try {
        walk(JSON.parse(raw), 0);
      } catch {
        // не JSON
      }
    }
  } catch {
    return [...ids];
  }

  return [...ids];
}

function collectRecordingIdsFromPlaudLocalStorage() {
  if (typeof localStorage === "undefined") return [];
  return collectRecordingIdsFromPlaudWebStorage(localStorage, 400);
}

function collectRecordingIdsFromPlaudSessionStorage() {
  if (typeof sessionStorage === "undefined") return [];
  return collectRecordingIdsFromPlaudWebStorage(sessionStorage, 220);
}

function mergeLocalStorageRecordingIdsIntoFiles(files) {
  const lsIds = collectRecordingIdsFromPlaudLocalStorage();
  const ssIds = collectRecordingIdsFromPlaudSessionStorage();
  const combined = [...new Set([...lsIds, ...ssIds])];

  const seenIds = new Set(
    files.map((f) => normalizeHexRecordingId(f.id) || String(f.id || "").toLowerCase())
  );
  let lsMerged = 0;
  const MAX_EXTRA_FROM_CACHE = 192;
  for (const hid of combined) {
    if (lsMerged >= MAX_EXTRA_FROM_CACHE) break;
    const id = String(hid).toLowerCase();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    files.push({
      id,
      title: id,
      raw: { file_id: id },
    });
    lsMerged++;
  }
  return {
    lsMerged,
    lsSeen: combined.length,
    lsFromLocal: lsIds.length,
    ssFromSession: ssIds.length,
  };
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

async function fetchPlaudTempUrlPayload(session, fileId) {
  return fetchPlaudApi(
    session,
    `/file/temp-url/${encodeURIComponent(fileId)}`
  );
}

async function fetchPlaudAudioUrl(session, fileId) {
  const payload = await fetchPlaudTempUrlPayload(session, fileId);
  const url = extractDownloadUrl(payload);
  if (!url) {
    throw new Error(`Для файла ${fileId} не получен URL аудио.`);
  }
  const titleHint = extractTitleForFileFromPayload(payload, fileId);
  return { url, titleHint };
}

async function tryFetchRecordingTitleHint(session, fileId) {
  try {
    const payload = await fetchPlaudTempUrlPayload(session, fileId);
    return extractTitleForFileFromPayload(payload, fileId);
  } catch {
    return "";
  }
}

function getArrayCandidates(payload) {
  const candidates = [
    payload?.data,
    payload?.data?.data,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data?.note_list,
    payload?.data_note_result,
    payload?.note_list,
    payload?.list,
    payload?.items,
  ];
  return candidates.filter(Array.isArray);
}

function isSummaryLikeNote(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const noteType = value.data_type || value.note_type || value.type;
  return SUMMARY_NOTE_TYPES.has(noteType);
}

function findSummaryNotes(payload) {
  const directNotes = getArrayCandidates(payload)
    .flat()
    .filter(isSummaryLikeNote);
  if (directNotes.length > 0) return directNotes;

  const notes = [];
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (isSummaryLikeNote(value)) notes.push(value);
    Object.values(value).forEach(walk);
  }
  walk(payload);
  return notes;
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
    return rawContent
      .map(parseSummaryContent)
      .filter(Boolean)
      .join("\n\n");
  }

  if (typeof rawContent === "object") {
    const directContent =
      rawContent.ai_content ||
      rawContent.content ||
      rawContent.summary ||
      rawContent.text ||
      rawContent.note_content;

    if (directContent != null) {
      return parseSummaryContent(directContent);
    }

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
    "Саммари"
  );
}

async function fetchPlaudSummaryExports(session, file) {
  const payload = await fetchPlaudApi(session, "/ai/query_note", {
    headers: { "file-id": file.id },
  });
  const notes = findSummaryNotes(payload);
  const summaries = [];

  for (const note of notes) {
    const rawContent = await getNoteRawContent(note);
    const content = parseSummaryContent(rawContent);
    if (!content) continue;

    const title =
      normalizeHumanTitle(getSummaryNoteTitle(note)) || "Саммари";
    summaries.push({
      title,
      markdown: `# ${file.title}\n\n${content}\n`,
    });
  }

  return summaries;
}

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(promise, ms, message) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

/**
 * Подсчёт записей и (опционально) саммари-заметок в текущем workspace Plaud Web.
 * Саммари считаются как элементы {@link findSummaryNotes} без загрузки внешних data_link.
 *
 * @param {{
 *   includeSummaries?: boolean;
 *   timeoutMs?: number;
 *   onProgress?: (p: { phase: "list" | "summaries"; current: number; total: number }) => void;
 * }} [options]
 * @returns {Promise<{ recordings: number; summaries: number; libraryStatsNote?: { countExplanation?: string } }>}
 */
export async function runLibraryStats(options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const includeSummaries = options.includeSummaries === true;
  const summaryTimeoutMs = Number(options.timeoutMs);
  const summaryTimeout =
    Number.isFinite(summaryTimeoutMs) && summaryTimeoutMs > 0
      ? summaryTimeoutMs
      : 180000;

  async function compute() {
    const session = getPlaudSession();

    onProgress?.({ phase: "list", current: 0, total: 1 });
    let files = await fetchPlaudFilesFromApi(session);
    mergeDomRecordingIdsIntoFiles(files);
    mergeLocalStorageRecordingIdsIntoFiles(files);

    const recordings = files.length;
    const trashSignals = countRecordingTrashSignals(files);
    const sumLiveTrash = trashSignals.likelyLive + trashSignals.trashy;
    const countExplainsSidebarGap =
      trashSignals.unclear === 0 &&
      recordings === sumLiveTrash &&
      trashSignals.likelyLive > 0;
    const countExplanation = countExplainsSidebarGap
      ? `По API: ${trashSignals.likelyLive} активных + ${trashSignals.trashy} в корзине = ${recordings} уникальных записей. Сумма «Все файлы + Unfiled + Корзина» в сайдбаре Plaud часто больше: Unfiled — часть «Все файлы», строки не суммируются.`
      : "";

    const libraryStatsNote = countExplanation
      ? { countExplanation }
      : undefined;
    onProgress?.({ phase: "list", current: 1, total: 1 });

    const summariesFromListMeta = countLikelySummariesFromFileMetadata(files);

    if (!includeSummaries) {
      return {
        recordings,
        summaries: summariesFromListMeta,
        libraryStatsNote,
      };
    }

    let summaries = 0;
    const concurrency = 4;
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i += concurrency) {
      const chunk = files.slice(i, i + concurrency);
      const counts = await Promise.all(
        chunk.map(async (file) => {
          try {
            const payload = await fetchPlaudApi(session, "/ai/query_note", {
              headers: { "file-id": file.id },
            });
            return findSummaryNotes(payload).length;
          } catch {
            return 0;
          }
        })
      );
      summaries += counts.reduce((a, b) => a + b, 0);
      onProgress?.({
        phase: "summaries",
        current: Math.min(i + chunk.length, totalFiles),
        total: totalFiles,
      });
    }

    return { recordings, summaries, libraryStatsNote };
  }

  if (includeSummaries) {
    return withTimeout(
      compute(),
      summaryTimeout,
      "Подсчёт саммари занял слишком много времени. Попробуйте позже или откройте Plaud на более простой странице."
    );
  }

  return compute();
}

function sanitizeFilenamePart(value, fallback = "plaud-audio") {
  return sanitizePathSegment(value, { fallback, maxLength: 140 });
}

function getExtensionFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // Fall back to MP3 below.
  }
  return "mp3";
}

function buildDownloadFilename(file, url) {
  const rawBase = sanitizeFilenamePart(file.title);
  const ext = getExtensionFromUrl(url);
  let core = rawBase;
  if (/\.[a-z0-9]{2,5}$/i.test(core)) {
    core = core.replace(/\.[a-z0-9]{2,5}$/i, "");
  }
  const filename = normalizeFilename(`${core}.audio`, {
    extension: ext,
    fallbackBase: "plaud-audio",
    maxBaseLength: 132,
  });
  return `${AUDIO_SUBDIRECTORY}/${filename}`;
}

function buildSummaryFilename(markdown, fallbackTitle, index = 0) {
  const title =
    extractTitleFromMarkdown(markdown) ||
    normalizeHumanTitle(fallbackTitle) ||
    "Plaud summary";
  const suffix = index > 0 ? ` ${index + 1}` : "";
  const filename = normalizeFilename(`${title}${suffix}`, {
    extension: ".md",
    fallbackBase: "Plaud summary",
    maxBaseLength: 132,
  });
  return `${SUMMARY_SUBDIRECTORY}/${filename}`;
}

function buildTextDataUrl(content, mimeType = "text/markdown") {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
}

function downloadTextViaBackground(content, filename, options = {}) {
  return downloadViaBackground(buildTextDataUrl(content), filename, options);
}

function downloadViaBackground(url, filename, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "downloadPlaudFile",
        url,
        filename,
        conflictAction: options.conflictAction,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success) {
          reject(new Error(response?.error || "Ошибка загрузки."));
          return;
        }
        resolve(response);
      }
    );
  });
}

function getCurrentPlaudSourceUrl() {
  if (typeof window === "undefined" || !window.location) return "";
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return window.location.href || "";
  }
}

function getRawField(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    const value = raw[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function buildAudioSignature(file) {
  const raw = file?.raw || {};
  const payload = {
    id: file?.id || "",
    size: getRawField(raw, [
      "size",
      "file_size",
      "fileSize",
      "audio_size",
      "audioSize",
      "bytes",
    ]),
    duration: getRawField(raw, [
      "duration",
      "duration_ms",
      "durationMs",
      "audio_duration",
      "audioDuration",
    ]),
    createdAt: getRawField(raw, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "start_time",
      "startTime",
    ]),
    updatedAt: getRawField(raw, [
      "updated_at",
      "updatedAt",
      "update_time",
      "updateTime",
      "modified_at",
      "modifiedAt",
    ]),
    checksum: getRawField(raw, ["md5", "sha256", "checksum", "etag"]),
  };
  return `audio-meta:${hashStringSync(JSON.stringify(payload))}`;
}

function buildSummaryBundle(summaryExports) {
  if (!Array.isArray(summaryExports) || summaryExports.length === 0) return "";
  return summaryExports
    .map((summaryExport) => String(summaryExport?.markdown || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function basenameFromDownloadPath(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || "";
}

function appendStableSuffixToFilename(filename, stableId) {
  const safeSuffix = sanitizePathSegment(
    String(stableId || "")
      .replace(/^plaud:/, "")
      .replace(/^fingerprint:/, "")
      .slice(0, 8),
    { fallback: "record", maxLength: 16 }
  );
  const safeName = basenameFromDownloadPath(filename);
  const dot = safeName.lastIndexOf(".");
  if (dot <= 0) return `${safeName} - ${safeSuffix}`;
  return `${safeName.slice(0, dot)} - ${safeSuffix}${safeName.slice(dot)}`;
}

function reservePlannedDownloadPath(path, stableId, usedPaths) {
  if (!usedPaths?.has(path)) {
    usedPaths?.add(path);
    return path;
  }
  const parts = String(path || "").split("/");
  const filename = parts.pop() || "Plaud export";
  const directory = parts.join("/");
  let candidate = `${directory}/${appendStableSuffixToFilename(filename, stableId)}`;
  let counter = 2;
  while (usedPaths.has(candidate)) {
    candidate = `${directory}/${appendStableSuffixToFilename(
      filename,
      `${stableId}-${counter}`
    )}`;
    counter++;
  }
  usedPaths.add(candidate);
  return candidate;
}

function isPathOwnedByOtherRecord(syncIndex, path, stableId) {
  const wantedPath = String(path || "");
  if (!wantedPath) return false;
  for (const [recordId, record] of Object.entries(syncIndex.records || {})) {
    if (recordId === stableId) continue;
    const paths = [
      record?.audioPath,
      record?.summaryPath,
      ...(Array.isArray(record?.summaryPaths) ? record.summaryPaths : []),
    ].filter(Boolean);
    if (paths.includes(wantedPath)) return true;
  }
  return false;
}

function buildCollisionSafePath(
  syncIndex,
  subdirectory,
  artifactType,
  filename,
  stableId
) {
  let path = buildRelativeArtifactPath(subdirectory, artifactType, filename);
  if (!isPathOwnedByOtherRecord(syncIndex, path, stableId)) return path;
  path = buildRelativeArtifactPath(
    subdirectory,
    artifactType,
    appendStableSuffixToFilename(filename, stableId)
  );
  return path;
}

async function buildSyncCandidate(file, summaryExports, sourceUrl) {
  const summaryBundle = buildSummaryBundle(summaryExports);
  const identity = buildStableId({
    ...file,
    raw: file.raw,
    title: file.title,
    sourceUrl,
    summaryMarkdown: summaryBundle,
    createdAt: getRawField(file.raw, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "start_time",
      "startTime",
    ]),
  });
  const firstSummary = Array.isArray(summaryExports) ? summaryExports[0] : null;
  const summaryTitle =
    extractTitleFromMarkdown(firstSummary?.markdown || "") ||
    normalizeHumanTitle(file.title) ||
    "Plaud summary";
  const audioExt = getExtensionFromUrl("");
  return {
    stableId: identity.stableId,
    identityKind: identity.identityKind,
    identityConfidence: identity.confidence,
    fingerprint: identity.fingerprint,
    title: normalizeHumanTitle(file.title) || summaryTitle,
    sourceUrl,
    summaryHash: await hashSummary(summaryBundle),
    audioSignature: buildAudioSignature(file),
    normalizedFilename: normalizeFilename(summaryTitle, {
      extension: ".md",
      fallbackBase: "Plaud summary",
      maxBaseLength: 132,
    }),
    audioNormalizedFilename: normalizeFilename(
      `${normalizeHumanTitle(file.title) || "plaud-audio"}.audio`,
      {
        extension: audioExt,
        fallbackBase: "plaud-audio",
        maxBaseLength: 132,
      }
    ),
    createdAt: getRawField(file.raw, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "start_time",
      "startTime",
    ]),
    updatedAt: getRawField(file.raw, [
      "updated_at",
      "updatedAt",
      "update_time",
      "updateTime",
      "modified_at",
      "modifiedAt",
    ]),
  };
}

function makeSyncStats() {
  return {
    status: "running",
    total: 0,
    processed: 0,
    new: 0,
    updated: 0,
    skipped: 0,
    alreadySynced: 0,
    errors: 0,
    audioDownloaded: 0,
    summariesDownloaded: 0,
    startedAt: Date.now(),
    finishedAt: null,
    currentTitle: "",
    lastMessage: "",
  };
}

/**
 * Smart background sync: uses Plaud API through the content-script context
 * (where Plaud session tokens are available), but persists a stable index in
 * chrome.storage.local and downloads through chrome.downloads. Chrome
 * extensions cannot reliably pick an arbitrary native folder from a service
 * worker; sync therefore targets a user-configurable subfolder inside the
 * browser Downloads directory.
 *
 * @param {{ syncSubdirectory?: string; onProgress?: (stats: object) => void }} [options]
 * @returns {Promise<object>}
 */
export async function runSmartSync(options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const requestedSubdir = sanitizeSyncSubdirectory(
    options.syncSubdirectory || DEFAULT_SYNC_SUBDIRECTORY
  );
  const stats = makeSyncStats();
  const sourceUrl = getCurrentPlaudSourceUrl();
  let syncIndex = await loadSyncIndex();
  syncIndex.settings = {
    ...syncIndex.settings,
    storageMode: "downloads_subfolder",
    syncSubdirectory: requestedSubdir,
  };
  await saveSyncIndex(syncIndex);

  function progress(patch = {}) {
    Object.assign(stats, patch);
    onProgress?.({ ...stats });
  }

  const session = getPlaudSession();
  let files = await fetchPlaudFilesFromApi(session);
  mergeDomRecordingIdsIntoFiles(files);
  mergeLocalStorageRecordingIdsIntoFiles(files);
  stats.total = files.length;
  progress({ lastMessage: `Найдено записей: ${files.length}` });

  for (const file of files) {
    stats.currentTitle = file.title;
    progress();

    try {
      let workingFile = file;
      let summaryExports = [];
      try {
        summaryExports = await fetchPlaudSummaryExports(session, workingFile);
      } catch (summaryError) {
        console.warn(
          `Smart sync: summary read failed for "${workingFile.title}":`,
          summaryError
        );
        summaryExports = [];
      }

      const candidate = await buildSyncCandidate(
        workingFile,
        summaryExports,
        sourceUrl
      );
      const duplicate = detectDuplicate(syncIndex, candidate);
      const existingRecord = duplicate?.record || null;
      const action = determineSyncAction(existingRecord, candidate);

      if (action.action === SYNC_ACTION_SKIPPED) {
        stats.skipped++;
        stats.processed++;
        if (candidate.stableId) {
          syncIndex.records[candidate.stableId] = updateExistingRecord(
            existingRecord,
            candidate,
            {
              status: SYNC_STATUS_SKIPPED,
            }
          );
          await saveSyncIndex(syncIndex);
        }
        progress({ lastMessage: `Пропущено: ${workingFile.title}` });
        continue;
      }

      if (action.action === SYNC_ACTION_ALREADY_SYNCED) {
        stats.alreadySynced++;
        stats.skipped++;
        stats.processed++;
        syncIndex.records[candidate.stableId] = updateExistingRecord(
          existingRecord,
          candidate,
          { status: SYNC_STATUS_SUCCESS }
        );
        await saveSyncIndex(syncIndex);
        progress({ lastMessage: `Уже синхронизировано: ${workingFile.title}` });
        continue;
      }

      if (action.metadataOnly) {
        stats.updated++;
        stats.processed++;
        syncIndex.records[candidate.stableId] = updateExistingRecord(
          existingRecord,
          candidate,
          { status: SYNC_STATUS_UPDATED }
        );
        await saveSyncIndex(syncIndex);
        progress({ lastMessage: `Обновлены метаданные: ${workingFile.title}` });
        continue;
      }

      const lastDownloadIds = [];
      let audioPath = existingRecord?.audioPath || "";
      let summaryPath = existingRecord?.summaryPath || "";
      let summaryPaths = Array.isArray(existingRecord?.summaryPaths)
        ? [...existingRecord.summaryPaths]
        : [];

      try {
        const { url, titleHint } = await fetchPlaudAudioUrl(
          session,
          workingFile.id
        );
        workingFile = preferApiTitle(workingFile, titleHint);
        candidate.audioUrl = url;
        candidate.audioNormalizedFilename = basenameFromDownloadPath(
          buildDownloadFilename(workingFile, url)
        );
        if (!audioPath) {
          audioPath = buildCollisionSafePath(
            syncIndex,
            requestedSubdir,
            "audio",
            candidate.audioNormalizedFilename,
            candidate.stableId
          );
        }
        const audioResponse = await downloadViaBackground(url, audioPath, {
          conflictAction: "overwrite",
        });
        if (audioResponse?.downloadId) {
          lastDownloadIds.push(audioResponse.downloadId);
        }
        stats.audioDownloaded++;
      } catch (audioError) {
        console.warn(
          `Smart sync: audio download failed for "${workingFile.title}":`,
          audioError
        );
        stats.errors++;
      }

      if (summaryExports.length > 0) {
        for (const [summaryIndex, summaryExport] of summaryExports.entries()) {
          const baseSummaryPath = buildSummaryFilename(
            summaryExport.markdown,
            summaryExport.title || workingFile.title,
            summaryIndex
          );
          const summaryFilename = basenameFromDownloadPath(baseSummaryPath);
          const targetPath =
            summaryPaths[summaryIndex] ||
            buildCollisionSafePath(
              syncIndex,
              requestedSubdir,
              "summary",
              summaryFilename,
              candidate.stableId
            );

          const summaryResponse = await downloadTextViaBackground(
            summaryExport.markdown,
            targetPath,
            { conflictAction: "overwrite" }
          );
          if (summaryResponse?.downloadId) {
            lastDownloadIds.push(summaryResponse.downloadId);
          }
          summaryPaths[summaryIndex] = targetPath;
          if (!summaryPath) summaryPath = targetPath;
          stats.summariesDownloaded++;
        }
      }

      if (action.action === SYNC_ACTION_NEW) {
        stats.new++;
      } else if (action.action === SYNC_ACTION_UPDATED) {
        stats.updated++;
      }

      stats.processed++;
      syncIndex.records[candidate.stableId] = {
        ...updateExistingRecord(existingRecord, candidate, {
          status:
            action.action === SYNC_ACTION_UPDATED
              ? SYNC_STATUS_UPDATED
              : SYNC_STATUS_SUCCESS,
          audioPath,
          summaryPath,
          lastDownloadIds,
        }),
        summaryPaths,
      };
      await saveSyncIndex(syncIndex);
      progress({ lastMessage: `Синхронизировано: ${workingFile.title}` });
    } catch (error) {
      console.error(`Smart sync failed for "${file.title}":`, error);
      stats.errors++;
      stats.processed++;
      progress({ lastMessage: `Ошибка: ${file.title}` });
      if (file?.id) {
        const identity = buildStableId(file);
        if (identity.stableId) {
          syncIndex.records[identity.stableId] = {
            ...(syncIndex.records[identity.stableId] || {}),
            stableId: identity.stableId,
            title: file.title || file.id,
            status: SYNC_STATUS_ERROR,
            lastError: error?.message || String(error),
            lastSyncedAt: new Date().toISOString(),
          };
          await saveSyncIndex(syncIndex);
        }
      }
    }
  }

  stats.status = "completed";
  stats.finishedAt = Date.now();
  stats.lastMessage = `Готово: ${stats.new} новых, ${stats.updated} обновлено, ${stats.skipped} пропущено.`;
  progress();
  return stats;
}

/**
 * Exports all Plaud audio files and updates progress. The primary path uses
 * Plaud Web's current API; the older DOM click flow remains as a fallback.
 *
 * @param {boolean} backgroundMode - Whether the export runs in background mode.
 * @param {Object} options - Export options.
 * @param {string} options.exportMode - One of "both", "audio", or "summary".
 * @param {{ id: string, title?: string }} [options.singleFile] - If set, export only this file via API (no full list fetch).
 * @returns {Object} stats - Export statistics including processed, errored, and skipped file counts.
 */
export async function runExportAll(backgroundMode = false, options = {}) {
  const exportMode = normalizeExportMode(options.exportMode);
  const shouldExportAudio =
    exportMode === EXPORT_MODE_BOTH || exportMode === EXPORT_MODE_AUDIO;
  const shouldExportSummaries =
    exportMode === EXPORT_MODE_BOTH || exportMode === EXPORT_MODE_SUMMARY;
  const indicator = createStatusIndicator();
  console.log(
    `Запуск экспорта Plaud (${getExportModeLabel(
      exportMode
    )}, фон: ${backgroundMode})…`
  );
  const stats = {
    exportMode,
    filesProcessed: 0,
    filesErrored: 0,
    filesSkipped: 0,
    audioExported: 0,
    audioErrors: 0,
    summariesExported: 0,
    summariesSkipped: 0,
    summaryErrors: 0,
    startTime: Date.now(),
  };
  const processedTitles = new Set();
  const plannedDownloadPaths = new Set();

  // --- updateProgress and shouldStopExport functions remain the same ---
  /**
   * Updates progress statistics and sends periodic progress notifications in background mode.
   * @param {string} current - The title of the current file.
   * @param {boolean} [error=false] - Flag indicating if an error occurred.
   */
  const updateProgress = (current, error = false) => {
    if (error) {
      stats.filesErrored++;
    } else {
      stats.filesProcessed++;
    }
    if (backgroundMode) {
      try {
        chrome.runtime
          .sendMessage({
            action: "exportProgressUpdate",
            data: { ...stats, currentTitle: current },
          })
          .catch((e) => console.warn("Failed to send progress update:", e));
      } catch (e) {
        console.warn("Error sending progress update:", e);
      }
    }
  };
  /**
   * Checks if the export process should stop.
   * @returns {Promise<boolean>} - Whether the export should stop.
   */
  async function shouldStopExport() {
    if (!backgroundMode) return false;
    try {
      return chrome.runtime
        .sendMessage({ action: "checkShouldStop" })
        .then((response) => response?.shouldStop)
        .catch(() => false);
    } catch (e) {
      console.warn("Error checking stop status:", e);
      return false;
    }
  }
  // --- End of unchanged functions ---

  let fileCount = 0;
  let errorCount = 0;
  const maxErrors = 3;

  async function tryDirectApiExport() {
    let session;
    try {
      session = getPlaudSession();
    } catch (error) {
      console.warn("Direct API export unavailable:", error.message);
      return false;
    }

    let files;
    if (options.singleFile?.id) {
      const sf = options.singleFile;
      const id =
        normalizeHexRecordingId(sf.id) ||
        String(sf.id || "")
          .trim()
          .toLowerCase();
      const title =
        normalizeHumanTitle(String(sf.title || sf.id).replace(/\s+/g, " ").trim()) ||
        id;
      files = [
        {
          id,
          title,
          raw: { file_id: id, file_name: title },
        },
      ];
    } else {
      try {
        files = await fetchPlaudFilesFromApi(session);
        mergeDomRecordingIdsIntoFiles(files);
        mergeLocalStorageRecordingIdsIntoFiles(files);
      } catch (error) {
        console.warn("Could not read Plaud file list from API:", error.message);
        return false;
      }
    }

    if (files.length === 0) {
      throw new Error(
        "API Plaud вернул 0 файлов. Откройте нужное рабочее пространство с записями."
      );
    }

    stats.filesTotal = files.length;
    const intro = options.singleFile?.id
      ? `Текущая запись. Загрузка (${getExportModeLabel(exportMode)})…`
      : `Найдено файлов: ${files.length}. Загрузка (${getExportModeLabel(
          exportMode
        )})…`;
    updateIndicator(indicator, intro);
    console.log(`Прямой экспорт по API: ${files.length} файл(ов).`);

    for (let file of files) {
      if (await shouldStopExport()) {
        updateIndicator(
          indicator,
          `Экспорт остановлен после ${stats.filesProcessed} файл(ов).`,
          "info"
        );
        return true;
      }

      if (errorCount >= maxErrors) {
        throw new Error(`Остановка после ${maxErrors} ошибок подряд.`);
      }

      fileCount++;
      let fileHadFatalError = false;
      let fileHadAnySuccess = false;

      if (shouldExportAudio) {
        updateIndicator(
          indicator,
          `Загрузка аудио №${fileCount}/${files.length}: ${file.title}…`
        );
        try {
          const { url, titleHint } = await fetchPlaudAudioUrl(session, file.id);
          file = preferApiTitle(file, titleHint);
          const filename = reservePlannedDownloadPath(
            buildDownloadFilename(file, url),
            file.id,
            plannedDownloadPaths
          );
          await downloadViaBackground(url, filename, {
            conflictAction: "overwrite",
          });
          stats.audioExported++;
          fileHadAnySuccess = true;
          console.log(`Downloaded "${file.title}" to ${filename}.`);
        } catch (audioError) {
          stats.audioErrors++;
          fileHadFatalError = true;
          console.error(
            `Direct audio download failed for "${file.title}":`,
            audioError.message
          );
          updateIndicator(
            indicator,
            `Ошибка загрузки аудио №${fileCount}: ${audioError.message.substring(
              0,
              50
            )}…`,
            "error"
          );
        }
      }

      if (shouldExportSummaries && !shouldExportAudio) {
        const titleHint = await tryFetchRecordingTitleHint(session, file.id);
        file = preferApiTitle(file, titleHint);
      }

      if (shouldExportSummaries) {
        updateIndicator(
          indicator,
          `Загрузка саммари №${fileCount}/${files.length}: ${file.title}…`
        );
        try {
          const summaryExports = await fetchPlaudSummaryExports(session, file);
          if (summaryExports.length > 0) {
            for (const [summaryIndex, summaryExport] of summaryExports.entries()) {
              await downloadTextViaBackground(
                summaryExport.markdown,
                reservePlannedDownloadPath(
                  buildSummaryFilename(
                    summaryExport.markdown,
                    summaryExport.title || file.title,
                    summaryIndex
                  ),
                  file.id,
                  plannedDownloadPaths
                ),
                { conflictAction: "overwrite" }
              );
              stats.summariesExported++;
              console.log(
                `Downloaded summary "${summaryExport.title}" for "${file.title}".`
              );
            }
            fileHadAnySuccess = true;
          } else {
            stats.summariesSkipped++;
            console.log(`No generated summary found for "${file.title}".`);
            if (exportMode === EXPORT_MODE_SUMMARY) {
              fileHadAnySuccess = true;
            }
          }
        } catch (summaryError) {
          stats.summaryErrors++;
          if (exportMode === EXPORT_MODE_SUMMARY) {
            fileHadFatalError = true;
          }
          console.warn(
            `Summary export failed for "${file.title}":`,
            summaryError.message
          );
          updateIndicator(
            indicator,
            `Ошибка загрузки саммари №${fileCount}: ${summaryError.message.substring(
              0,
              50
            )}…`,
            "error"
          );
        }
      }

      if (fileHadFatalError || !fileHadAnySuccess) {
        errorCount++;
        updateProgress(file.title, true);
      } else {
        updateProgress(file.title);
        errorCount = 0;
      }
    }

    stats.endTime = Date.now();
    stats.duration = stats.endTime - stats.startTime;
    updateIndicator(
      indicator,
      `Готово! Аудио: ${stats.audioExported}, саммари: ${stats.summariesExported}.`,
      stats.filesErrored ? "error" : "success"
    );
    setTimeout(() => indicator.remove(), 6000);
    return true;
  }

  const directApiHandled = await tryDirectApiExport();
  if (directApiHandled) {
    return stats;
  }
  if (options.singleFile?.id) {
    throw new Error(
      "Не удалось экспортировать эту запись через API. Войдите в аккаунт на Plaud Web."
    );
  }
  if (shouldExportSummaries) {
    throw new Error(
      "Экспорт саммари нужен через API Plaud Web. Устаревший режим через страницу выгружает только аудио."
    );
  }
  return await runDomExportFallback({
    backgroundMode,
    indicator,
    stats,
    processedTitles,
    shouldStopExport,
    updateProgress,
  });
}
