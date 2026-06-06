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
import { fetchOfficialSummaries } from "./officialPlaudApi.js";
import {
  findSummaryNotes,
  getNoteDataLink,
  getNoteInlineContent,
  getSummaryNoteTitle,
  parseSummaryContent,
  stripPlaudInlineAssets,
} from "../../../plaud-exporter/common/plaudSummaries.js";
import { normalizeHumanTitle } from "../../../plaud-exporter/common/plaudTitles.js";

export {
  findSummaryNotes,
  getSummaryNoteTitle,
  parseSummaryContent,
  stripPlaudInlineAssets,
  SUMMARY_NOTE_TYPES,
} from "../../../plaud-exporter/common/plaudSummaries.js";

async function getNoteRawContent(note) {
  const inline = getNoteInlineContent(note);
  if (inline) return inline;
  const dataLink = getNoteDataLink(note);
  if (!dataLink) return "";
  return fetchUrlTextWithRetries(dataLink);
}

/**
 * @returns {Promise<Array<{ title: string; markdown: string }>>}
 */
export async function fetchSummaries(session, file) {
  if (session?.apiMode === "official") {
    return fetchOfficialSummaries(session, file);
  }
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
