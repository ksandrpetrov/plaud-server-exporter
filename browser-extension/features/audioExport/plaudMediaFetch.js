/**
 * features/audioExport/plaudMediaFetch.js
 * Summary markdown assembly and media URL / summary export fetching.
 */
import { extractTitleFromMarkdown } from "../../common/exportPathUtils.js";
import {
  extractTitleForFileFromPayload,
  isPlausibleRecordingTitle,
  normalizeHumanTitle,
  titleLooksLikeRawId,
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
  describePayloadShape,
  fetchPlaudApi,
  fetchUrlTextWithRetries,
  plaudExportDebug,
  redactUrlForLog,
} from "./plaudBrowserApi.js";

export function buildSummaryMarkdownForFile(file, content, noteTitle = "") {
  const contentTitle = extractTitleFromMarkdown(content);
  const fileTitle = normalizeHumanTitle(file?.title);
  const safeFileTitle =
    fileTitle && !titleLooksLikeRawId(fileTitle, file?.id) ? fileTitle : "";
  const safeNoteTitle = isPlausibleRecordingTitle(noteTitle)
    ? normalizeHumanTitle(noteTitle)
    : "";
  const title =
    safeFileTitle || contentTitle || safeNoteTitle || "Plaud summary";
  const body = String(content || "").trim();
  const hasMarkdownHeading = /^\s{0,3}#{1,6}\s+\S/m.test(body);
  const firstHeadingTitle = extractTitleFromMarkdown(body);
  const alreadyHasTitleHeading =
    firstHeadingTitle &&
    normalizeHumanTitle(firstHeadingTitle).toLowerCase() ===
      normalizeHumanTitle(title).toLowerCase();
  const shouldAddTitleHeading =
    safeFileTitle || !hasMarkdownHeading || !alreadyHasTitleHeading;
  const markdown =
    shouldAddTitleHeading && !alreadyHasTitleHeading
      ? `# ${title}\n\n${body}\n`
      : `${body}\n`;
  return { title, markdown };
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

export function extractDownloadUrl(payload) {
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

export async function fetchPlaudTempUrlPayload(session, fileId) {
  return fetchPlaudApi(session, `/file/temp-url/${encodeURIComponent(fileId)}`);
}

export async function fetchPlaudAudioUrl(session, fileId) {
  const payload = await fetchPlaudTempUrlPayload(session, fileId);
  const url = extractDownloadUrl(payload);
  if (!url) {
    throw new Error(`Для файла ${fileId} не получен URL аудио.`);
  }
  const titleHint = extractTitleForFileFromPayload(payload, fileId);
  return { url, titleHint };
}

export async function tryFetchRecordingTitleHint(session, fileId) {
  try {
    const payload = await fetchPlaudTempUrlPayload(session, fileId);
    return extractTitleForFileFromPayload(payload, fileId);
  } catch {
    return "";
  }
}

export async function fetchPlaudSummaryExports(session, file) {
  plaudExportDebug("summary:query-note:start", {
    fileId: file.id,
    title: file.title,
  });
  let payload;
  try {
    payload = await fetchPlaudApi(session, "/ai/query_note", {
      headers: { "file-id": file.id },
    });
  } catch (error) {
    console.warn("[Plaud Export] summary:query-note:error", {
      fileId: file.id,
      title: file.title,
      message: error?.message || String(error),
      error,
    });
    throw error;
  }
  plaudExportDebug("summary:query-note:payload", {
    fileId: file.id,
    title: file.title,
    shape: describePayloadShape(payload),
  });
  const notes = findSummaryNotes(payload);
  plaudExportDebug("summary:notes:found", {
    fileId: file.id,
    title: file.title,
    count: notes.length,
    notes: notes.map((note, index) => {
      const raw = /** @type {any} */ (note);
      const inline = getNoteInlineContent(note);
      const dataLink = getNoteDataLink(note);
      return {
        index,
        type: raw.data_type || raw.note_type || raw.type || "",
        title: getSummaryNoteTitle(note, ""),
        hasInline: !!inline,
        inlineChars: inline.length,
        dataLink: redactUrlForLog(dataLink),
        topKeys: Object.keys(raw).slice(0, 20),
      };
    }),
  });
  const summaries = [];

  for (const note of notes) {
    const inline = getNoteInlineContent(note);
    const dataLink = getNoteDataLink(note);
    plaudExportDebug("summary:note:read:start", {
      fileId: file.id,
      title: file.title,
      noteTitle: getSummaryNoteTitle(note, ""),
      hasInline: !!inline,
      inlineChars: inline.length,
      dataLink: redactUrlForLog(dataLink),
    });
    const rawContent =
      inline || (dataLink ? await fetchUrlTextWithRetries(dataLink) : "");
    const content = stripPlaudInlineAssets(parseSummaryContent(rawContent));
    plaudExportDebug("summary:note:parsed", {
      fileId: file.id,
      title: file.title,
      noteTitle: getSummaryNoteTitle(note, ""),
      rawChars: String(rawContent || "").length,
      contentChars: content.length,
    });
    if (!content) {
      plaudExportDebug("summary:note:skip-empty", {
        fileId: file.id,
        title: file.title,
        noteTitle: getSummaryNoteTitle(note, ""),
      });
      continue;
    }

    const noteTitle = getSummaryNoteTitle(note, "Саммари");
    summaries.push(buildSummaryMarkdownForFile(file, content, noteTitle));
  }

  plaudExportDebug("summary:exports:ready", {
    fileId: file.id,
    title: file.title,
    count: summaries.length,
    markdownChars: summaries.map((summary) => summary.markdown.length),
  });
  return summaries;
}
