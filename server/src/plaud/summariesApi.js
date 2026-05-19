/**
 * Plaud `/ai/query_note` endpoint and the markdown extraction it needs.
 *
 * Summary notes can either embed Markdown inline (`data_content`) or point
 * at a presigned URL (`data_link`); both shapes are normalized to plain
 * Markdown strings here. Plaud-CDN image references that would render as
 * broken images inside Obsidian are stripped.
 */
import { PlaudChangedError } from "./errors.js";
import { fetchPlaudApi, fetchUrlTextWithRetries } from "./httpTransport.js";
import { normalizeHumanTitle } from "./recordingsApi.js";

const SUMMARY_NOTE_TYPES = new Set([
  "summary",
  "auto_sum_note",
  "sum_multi_note",
]);

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
