/**
 * Official Plaud Developer API client (`platform.plaud.ai/developer/api`).
 * Used when session.apiMode === "official" (OAuth auth).
 */
import { config } from "../config/config.js";
import { PlaudAuthError, PlaudChangedError } from "./errors.js";
import { normalizePlaudRecordingId } from "../../../browser-extension/common/plaudRecordingIds.js";
import {
  normalizeHumanTitle,
  pickRawTitleFromFile,
} from "../../../browser-extension/common/plaudTitles.js";
import {
  findSummaryNotes,
  getNoteDataLink,
  getNoteInlineContent,
  getSummaryNoteTitle,
  parseSummaryContent,
  stripPlaudInlineAssets,
} from "../../../browser-extension/common/plaudSummaries.js";
import { fetchUrlTextWithRetries } from "./httpTransport.js";

/** Official API rejects page_size below 10. */
const OFFICIAL_API_MIN_PAGE_SIZE = 10;

function officialApiUrl(session, path) {
  const base = session.apiBase.endsWith("/")
    ? session.apiBase
    : `${session.apiBase}/`;
  const relative = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relative, base).toString();
}

function normalizeOfficialFile(rawFile) {
  const id = normalizePlaudRecordingId(rawFile);
  if (!id) return null;
  const title =
    normalizeHumanTitle(pickRawTitleFromFile(rawFile)) || String(id);
  return { id, title, raw: rawFile, folderIds: [], folderSegment: "" };
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

/**
 * @param {Record<string, any>} session
 * @param {string} path
 * @param {{ method?: string; headers?: Record<string, string> }} [options]
 */
async function fetchOfficialPlaudApi(session, path, options = {}) {
  const { method = "GET", headers = {} } = options;
  const url = officialApiUrl(session, path);
  let lastError;
  const max = config.apiMaxRetries;

  for (let attempt = 0; attempt < max; attempt++) {
    if (attempt > 0) await sleepMs(Math.min(8000, 500 * 2 ** (attempt - 1)));
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method,
          headers: {
            Authorization: session.authHeader,
            Accept: "application/json",
            ...config.plaudOAuthExtraHeaders,
            ...headers,
          },
        },
        config.apiTimeoutMs
      );

      if (response.status === 401 || response.status === 403) {
        throw new PlaudAuthError(
          `Plaud official API auth failed (HTTP ${response.status}).`,
          response.status
        );
      }

      if (!response.ok) {
        throw new Error(`Plaud official API HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof PlaudAuthError) throw error;
      if (attempt >= max - 1) throw error;
    }
  }
  throw lastError;
}

/**
 * @param {Record<string, any>} session
 * @param {number} page
 * @param {number} pageSize
 */
async function listOfficialFilesPage(session, page, pageSize) {
  return fetchOfficialPlaudApi(
    session,
    `/open/third-party/files/?page=${page}&page_size=${pageSize}`
  );
}

/**
 * @param {Record<string, any>} session
 */
export async function listAllOfficialRecordings(session) {
  const pageSize = Math.min(100, Math.max(10, config.apiPageLimit));
  const maxFiles = config.apiMaxFiles;
  const byId = new Map();
  let page = 1;

  while (byId.size < maxFiles) {
    const payload = await listOfficialFilesPage(session, page, pageSize);
    const items = payload?.data;
    if (!Array.isArray(items)) {
      throw new PlaudChangedError(
        "Plaud official files response has an unexpected shape.",
        { endpoint: "/open/third-party/files/" }
      );
    }
    if (items.length === 0) break;

    for (const raw of items) {
      const file = normalizeOfficialFile(raw);
      if (file) byId.set(file.id, file);
    }

    if (items.length < pageSize) break;
    page += 1;
    if (page > 1000) break;
  }

  return [...byId.values()];
}

async function getNoteRawContent(note) {
  const inline = getNoteInlineContent(note);
  if (inline) return inline;
  const dataLink = getNoteDataLink(note);
  if (!dataLink) return "";
  return fetchUrlTextWithRetries(dataLink);
}

/**
 * @param {Record<string, any>} session
 * @param {{ id: string; title?: string }} file
 */
export async function fetchOfficialSummaries(session, file) {
  const payload = await fetchOfficialPlaudApi(
    session,
    `/open/third-party/files/${encodeURIComponent(file.id)}`
  );
  const notes = findSummaryNotes({ data: payload?.note_list ?? payload });
  if (!notes.length && payload?.note_list === undefined) {
    throw new PlaudChangedError(
      "Plaud official file response has an unexpected shape; no summary notes found.",
      { endpoint: `/open/third-party/files/${file.id}`, fileId: file.id }
    );
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

/**
 * @param {Record<string, any>} session
 */
export async function validateOfficialSession(session) {
  const payload = await listOfficialFilesPage(
    session,
    1,
    OFFICIAL_API_MIN_PAGE_SIZE
  );
  return Array.isArray(payload?.data) ? payload.data.length : 0;
}
