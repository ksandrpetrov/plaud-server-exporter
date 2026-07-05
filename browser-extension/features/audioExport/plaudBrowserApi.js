/**
 * features/audioExport/plaudBrowserApi.js
 * Plaud Web API transport, file list fan-out, debug helpers.
 */
import {
  attachFolderSegmentsToFiles,
  mergeFiletagsById,
  parseFiletagListPayload,
} from "../../common/plaudFolders.js";
import {
  buildPlaudRecordingFanoutPlan,
  paginatePlaudRecordingVariant,
  runPlaudRecordingFanout,
} from "../../common/plaudRecordings.js";
import { buildPlaudHeaders, normalizeApiBase } from "./plaudBrowserSession.js";
import { shouldRetryPlaudFetchAttempt } from "./plaudFetchRetry.js";

export const PLAUD_API_PAGE_LIMIT = 100;
export const PLAUD_API_MAX_FILES = 5000;
export const PLAUD_FETCH_TIMEOUT_MS = 45000;

const PLAUD_FETCH_MAX_RETRIES = 3;

function isPlaudExportDebugEnabled() {
  try {
    return globalThis.localStorage?.getItem("plaudExporterDebug") !== "0";
  } catch {
    return true;
  }
}

export function plaudExportDebug(event, details = {}) {
  if (!isPlaudExportDebugEnabled()) return;
  console.info(`[Plaud Export] ${event}`, details);
}

export function redactUrlForLog(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    const pathParts = url.pathname.split("/").filter(Boolean).slice(0, 3);
    const path = pathParts.length ? `/${pathParts.join("/")}` : "";
    const hasQuery = url.search ? "?…" : "";
    return `${url.origin}${path}${hasQuery}`;
  } catch {
    return "[invalid-url]";
  }
}

export function describePayloadShape(payload) {
  if (payload == null || typeof payload !== "object") {
    return { type: payload == null ? "null" : typeof payload };
  }
  const data = /** @type {any} */ (payload).data;
  const status = /** @type {any} */ (payload).status;
  const message = /** @type {any} */ (payload).message;
  const shape = {
    type: Array.isArray(payload) ? "array" : "object",
    topKeys: Object.keys(payload).slice(0, 20),
    status,
    message: typeof message === "string" ? message.slice(0, 200) : "",
  };
  if (Array.isArray(payload)) {
    return { ...shape, length: payload.length };
  }
  if (Array.isArray(data)) {
    return { ...shape, dataType: "array", dataLength: data.length };
  }
  if (data && typeof data === "object") {
    return {
      ...shape,
      dataType: "object",
      dataKeys: Object.keys(data).slice(0, 20),
    };
  }
  return { ...shape, dataType: data == null ? "null" : typeof data };
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, init, timeoutMs) {
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

export async function fetchPlaudApi(session, path, options = {}) {
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

export async function fetchUrlTextWithRetries(url) {
  let lastError;
  for (let attempt = 0; attempt < PLAUD_FETCH_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    }
    try {
      plaudExportDebug("summary:data-link:fetch:start", {
        attempt: attempt + 1,
        url: redactUrlForLog(url),
      });
      const response = await fetchWithTimeout(url, {}, PLAUD_FETCH_TIMEOUT_MS);
      plaudExportDebug("summary:data-link:fetch:response", {
        attempt: attempt + 1,
        status: response.status,
        ok: response.ok,
        url: redactUrlForLog(url),
      });
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
      const text = await response.text();
      plaudExportDebug("summary:data-link:fetch:done", {
        attempt: attempt + 1,
        chars: text.length,
        url: redactUrlForLog(url),
      });
      return text;
    } catch (error) {
      lastError = error;
      plaudExportDebug("summary:data-link:fetch:error", {
        attempt: attempt + 1,
        message: error?.message || String(error),
        url: redactUrlForLog(url),
      });
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

/** @returns {{ trashy: number; likelyLive: number; unclear: number }} */
export function countRecordingTrashSignals(files) {
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
export function rawIndicatesLikelySummary(raw) {
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

export function countLikelySummariesFromFileMetadata(files) {
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
export async function fetchPlaudFilesFromApi(session) {
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
