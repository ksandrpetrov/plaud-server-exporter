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
} from "../../common/plaudRecordingIds.js";
import {
  DEFAULT_SYNC_SUBDIRECTORY,
  EXPORT_MODE_AUDIO,
  EXPORT_MODE_BOTH,
  EXPORT_MODE_SUMMARY,
  extractTitleFromMarkdown,
  normalizeExportMode,
  normalizeFilename,
  withUtf8Bom,
} from "../../common/exportPathUtils.js";
import {
  normalizeHumanTitle,
  PLAUD_TITLE_KEYS,
} from "../../common/plaudTitles.js";
import {
  findSummaryNotes,
  getNoteDataLink,
  getNoteInlineContent,
  getSummaryNoteTitle,
  parseSummaryContent,
  stripPlaudInlineAssets,
} from "../../common/plaudSummaries.js";
import {
  buildAudioSignature,
  buildStableId,
  buildSummaryBundle,
  detectDuplicate,
  determineSyncAction,
  getRawField,
  hashSummary,
  refineSyncActionForDisk,
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
import {
  attachFolderSegmentsToFiles,
  mergeFiletagsById,
  parseFiletagListPayload,
  PLAUD_FOLDER_UNFILED,
} from "../../common/plaudFolders.js";
import {
  buildPlaudRecordingFanoutPlan,
  paginatePlaudRecordingVariant,
  runPlaudRecordingFanout,
} from "../../common/plaudRecordings.js";
import {
  ACTION_CHECK_SHOULD_STOP,
  ACTION_DOWNLOAD_PLAUD_FILE,
  ACTION_EXPORT_PROGRESS_UPDATE,
} from "../../common/runtimeMessages.js";
import {
  buildPlaudHeaders,
  getPlaudSession,
  normalizeApiBase,
} from "./plaudBrowserSession.js";
import {
  mergeDomRecordingIdsIntoFiles,
  mergeLocalStorageRecordingIdsIntoFiles,
} from "./plaudRecordingIdScraper.js";
import {
  basenameFromDownloadPath,
  buildCollisionSafePath,
  buildDownloadFilename,
  buildSummaryFilename,
  getExtensionFromUrl,
  reservePlannedDownloadPath,
} from "./plaudCollisionPaths.js";
import { runDomExportFallback } from "./domExportFallback.js";
const PLAUD_API_PAGE_LIMIT = 100;
const PLAUD_API_MAX_FILES = 5000;

function getExportModeLabel(mode) {
  if (mode === EXPORT_MODE_AUDIO) return "аудио";
  if (mode === EXPORT_MODE_SUMMARY) return "саммари";
  return "аудио и саммари";
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
  const { retryDomainSwitch = true, headers = {}, method = "GET" } = options;
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
        `Таймаут запроса к API Plaud (${PLAUD_FETCH_TIMEOUT_MS} мс)`,
        { cause: error }
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
      const response = await fetchWithTimeout(url, {}, PLAUD_FETCH_TIMEOUT_MS);
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

async function fetchPlaudFiletagListWithAuth(session, authHeader) {
  const h = authHeader || session.authHeader;
  const reqHeaders = { Authorization: h };
  try {
    const payload = await fetchPlaudApi(session, "/filetag/", {
      headers: reqHeaders,
    });
    return parseFiletagListPayload(payload);
  } catch {
    const payload = await fetchPlaudApi(session, "/filetag", {
      headers: reqHeaders,
    });
    return parseFiletagListPayload(payload);
  }
}

async function fetchPlaudFiletagList(session) {
  const ua = session.userAuthHeader || "";
  const wa = session.workspaceAuthHeader || "";
  const buckets = [];
  let userTags;
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

  return paginatePlaudRecordingVariant({
    fetchPage: async (query) => {
      const qs = new URLSearchParams(query).toString();
      return fetchPlaudApi(session, `/file/simple/web?${qs}`);
    },
    fixedParams,
    sortBy: session.sortBy,
    pageLimit,
    maxFiles: PLAUD_API_MAX_FILES,
    maxPages,
    isDesc: opts.isDesc !== false,
  });
}

/**
 * Полный список записей workspace: активные + корзина + обход папок (включая Unfiled).
 * На странице Plaud Web prefetch вызывает `/file/simple/web` с **is_trash=2** (не 0 и не пустой query).
 */
async function fetchPlaudFilesFromApi(session) {
  let tags;
  try {
    tags = await fetchPlaudFiletagList(session);
  } catch {
    tags = [];
  }

  const files = await runPlaudRecordingFanout({
    fetchVariant: (params, variantOpts) =>
      fetchPlaudFilesOneListVariant(session, params, variantOpts || {}),
    plan: buildPlaudRecordingFanoutPlan({
      tags,
      includeTrash: true,
      maxFiles: PLAUD_API_MAX_FILES,
    }),
    onVariantError: () => {
      // часть параметров может быть недоступна на части сборок API
    },
  });

  return attachFolderSegmentsToFiles(files, tags);
}

function looksLikeDownloadUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  return (
    /\.(mp3|m4a|wav|opus|ogg|aac|mp4)([?#].*)?$/i.test(value) ||
    /audio|resource|download|file|object|presign|temp/i.test(value)
  );
}

function extractKnownDownloadUrlFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  const data = /** @type {any} */ (payload).data;
  const candidates = [
    /** @type {any} */ (payload).presigned_url,
    /** @type {any} */ (payload).presignedUrl,
    /** @type {any} */ (payload).url,
    data?.presigned_url,
    data?.presignedUrl,
    data?.url,
    data?.download_url,
    data?.downloadUrl,
    data?.temp_url,
    data?.tempUrl,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function extractDownloadUrl(payload) {
  const direct = extractKnownDownloadUrlFromPayload(payload);
  if (direct) return direct;

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
  return fetchPlaudApi(session, `/file/temp-url/${encodeURIComponent(fileId)}`);
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

async function fetchPlaudSummaryExports(session, file) {
  const payload = await fetchPlaudApi(session, "/ai/query_note", {
    headers: { "file-id": file.id },
  });
  const notes = findSummaryNotes(payload);
  const summaries = [];

  for (const note of notes) {
    const inline = getNoteInlineContent(note);
    const dataLink = getNoteDataLink(note);
    const rawContent =
      inline || (dataLink ? await fetchUrlTextWithRetries(dataLink) : "");
    const content = stripPlaudInlineAssets(parseSummaryContent(rawContent));
    if (!content) continue;

    const title =
      normalizeHumanTitle(getSummaryNoteTitle(note, "Саммари")) || "Саммари";
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
    mergeDomRecordingIdsIntoFiles(files, {
      unfiledLabel: PLAUD_FOLDER_UNFILED,
    });
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

function buildSummaryFilenameForFile(
  markdown,
  fallbackTitle,
  index = 0,
  file = null
) {
  return buildSummaryFilename(
    markdown,
    fallbackTitle,
    index,
    file,
    normalizeHumanTitle
  );
}

function requestDownloadViaBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: ACTION_DOWNLOAD_PLAUD_FILE,
        ...payload,
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

function downloadTextViaBackground(content, filename, options = {}) {
  return requestDownloadViaBackground({
    textContent: withUtf8Bom(content),
    mimeType: "text/markdown;charset=utf-8",
    filename,
    conflictAction: options.conflictAction,
  });
}

/**
 * URL download via chrome.downloads; on failure fetches the file in the page
 * context (presigned URLs / cookies) and hands the service worker a blob
 * object URL. Raw bytes must not be relayed through chrome.runtime.sendMessage:
 * messages are JSON-serialized, so an ArrayBuffer arrives as `{}`. The object
 * URL is created here because MV3 service workers have no URL.createObjectURL.
 */
async function downloadViaBackground(url, filename, options = {}) {
  const basePayload = {
    filename,
    conflictAction: options.conflictAction,
  };
  try {
    return await requestDownloadViaBackground({ ...basePayload, url });
  } catch (directError) {
    let response;
    try {
      response = await fetchWithTimeout(url, {}, PLAUD_FETCH_TIMEOUT_MS);
    } catch {
      throw directError;
    }
    if (!response.ok) {
      throw new Error(
        `${directError.message} (повтор через fetch: HTTP ${response.status})`,
        { cause: directError }
      );
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      // The bridge waits for download completion, so revoking afterwards is safe.
      return await requestDownloadViaBackground({
        ...basePayload,
        url: blobUrl,
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
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
    folderSegment: String(file.folderSegment || PLAUD_FOLDER_UNFILED).trim(),
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
  const syncMode = options.syncMode === "summary" ? "summary" : "both";
  const shouldDownloadAudio = syncMode !== "summary";
  const stats = makeSyncStats();
  const sourceUrl = getCurrentPlaudSourceUrl();
  let syncIndex = await loadSyncIndex();
  syncIndex.settings = {
    ...syncIndex.settings,
    storageMode: "downloads_subfolder",
    syncSubdirectory: requestedSubdir,
    syncMode,
  };
  await saveSyncIndex(syncIndex);

  function progress(patch = {}) {
    Object.assign(stats, patch);
    onProgress?.({ ...stats });
  }

  const session = getPlaudSession();
  let files = await fetchPlaudFilesFromApi(session);
  mergeDomRecordingIdsIntoFiles(files, { unfiledLabel: PLAUD_FOLDER_UNFILED });
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

      let plannedSummaryPath = "";
      if (summaryExports.length > 0) {
        const firstSummary = summaryExports[0];
        const baseSummaryPath = buildSummaryFilenameForFile(
          firstSummary.markdown,
          firstSummary.title || workingFile.title,
          0,
          workingFile
        );
        const summaryFilename = basenameFromDownloadPath(baseSummaryPath);
        plannedSummaryPath = buildCollisionSafePath(
          syncIndex,
          requestedSubdir,
          "summary",
          summaryFilename,
          candidate.stableId,
          candidate.folderSegment
        );
      }

      let action = determineSyncAction(existingRecord, candidate);
      action = refineSyncActionForDisk(action, existingRecord, {
        plannedSummaryPath,
        summaryMissingOnDisk: false,
      });

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

      const folderRelocate =
        action.metadataOnly &&
        String(existingRecord?.folderSegment || "").trim() !==
          String(candidate.folderSegment || "").trim();

      if (action.metadataOnly && !folderRelocate) {
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
      let audioPath = folderRelocate ? "" : existingRecord?.audioPath || "";
      let summaryPath = folderRelocate ? "" : existingRecord?.summaryPath || "";
      let summaryPaths =
        folderRelocate || !Array.isArray(existingRecord?.summaryPaths)
          ? []
          : [...existingRecord.summaryPaths];

      try {
        if (shouldDownloadAudio) {
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
              candidate.stableId,
              candidate.folderSegment
            );
          }
          const audioResponse = await downloadViaBackground(url, audioPath, {
            conflictAction: "overwrite",
          });
          if (audioResponse?.downloadId) {
            lastDownloadIds.push(audioResponse.downloadId);
          }
          stats.audioDownloaded++;
        }
      } catch (audioError) {
        console.warn(
          `Smart sync: audio download failed for "${workingFile.title}":`,
          audioError
        );
        stats.errors++;
      }

      if (summaryExports.length > 0) {
        for (const [summaryIndex, summaryExport] of summaryExports.entries()) {
          const baseSummaryPath = buildSummaryFilenameForFile(
            summaryExport.markdown,
            summaryExport.title || workingFile.title,
            summaryIndex,
            workingFile
          );
          const summaryFilename = basenameFromDownloadPath(baseSummaryPath);
          const targetPath =
            (!folderRelocate && summaryPaths[summaryIndex]) ||
            buildCollisionSafePath(
              syncIndex,
              requestedSubdir,
              "summary",
              summaryFilename,
              candidate.stableId,
              candidate.folderSegment
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
            action: ACTION_EXPORT_PROGRESS_UPDATE,
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
        .sendMessage({ action: ACTION_CHECK_SHOULD_STOP })
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
        normalizeHumanTitle(
          String(sf.title || sf.id)
            .replace(/\s+/g, " ")
            .trim()
        ) || id;
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
        const apiCount = files.length;
        mergeDomRecordingIdsIntoFiles(files, {
          unfiledLabel: PLAUD_FOLDER_UNFILED,
        });
        mergeLocalStorageRecordingIdsIntoFiles(files, {
          maxExtraFromCache: Math.max(0, PLAUD_API_MAX_FILES - apiCount),
        });
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

      try {
        session = getPlaudSession();
      } catch (sessionError) {
        throw new Error(
          sessionError?.message ||
            "Сессия Plaud недоступна. Обновите вкладку Plaud Web и войдите снова.",
          { cause: sessionError }
        );
      }

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
            for (const [
              summaryIndex,
              summaryExport,
            ] of summaryExports.entries()) {
              await downloadTextViaBackground(
                summaryExport.markdown,
                reservePlannedDownloadPath(
                  buildSummaryFilenameForFile(
                    summaryExport.markdown,
                    summaryExport.title || file.title,
                    summaryIndex,
                    file
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

  try {
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
  } catch (error) {
    updateIndicator(indicator, error?.message || String(error), "error");
    setTimeout(() => indicator.remove(), 6000);
    throw error;
  }
}
