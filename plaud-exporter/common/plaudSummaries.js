/**
 * Shared Plaud summary markdown helpers (server + extension).
 */

/** Plaud CDN image refs that break in Obsidian / Downloads exports. */
const PLAUD_INLINE_ASSET_RE =
  /!\[[^\]]*\]\(\s*(?:<\s*)?(?:permanent\/[^)\s>]*|[^)\s>]*summary_poster\/[^)\s>]*)(?:\s*>)?\s*\)/g;

/** Note types Plaud uses for AI summaries in `/ai/query_note` payloads. */
export const SUMMARY_NOTE_TYPES = new Set([
  "summary",
  "auto_sum_note",
  "sum_multi_note",
]);

/**
 * Strip Plaud-hosted inline images from summary markdown before persisting.
 *
 * @param {unknown} markdown
 * @returns {string}
 */
export function stripPlaudInlineAssets(markdown) {
  if (typeof markdown !== "string" || !markdown) return "";
  return markdown
    .replace(PLAUD_INLINE_ASSET_RE, "")
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
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

/**
 * Walk a Plaud `/ai/query_note` payload and collect summary note objects.
 *
 * @param {unknown} payload
 * @returns {object[]}
 */
export function findSummaryNotes(payload) {
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
 * Normalize Plaud summary note content (string, JSON string, array, or object).
 *
 * @param {unknown} rawContent
 * @returns {string}
 */
export function parseSummaryContent(rawContent) {
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
    /** @type {any} */
    const record = rawContent;
    const directContent =
      record.ai_content ||
      record.content ||
      record.summary ||
      record.text ||
      record.note_content;
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

/**
 * Inline summary body from a note object, or empty when only `data_link` is set.
 *
 * @param {object | null | undefined} note
 * @returns {string}
 */
export function getNoteInlineContent(note) {
  if (!note || typeof note !== "object") return "";
  if (note.data_content) return note.data_content;
  if (note.note_content) return note.note_content;
  return "";
}

/**
 * @param {object | null | undefined} note
 * @returns {string}
 */
export function getNoteDataLink(note) {
  if (!note || typeof note !== "object") return "";
  return note.data_link ? String(note.data_link) : "";
}

/**
 * @param {object | null | undefined} note
 * @param {string} [defaultTitle]
 * @returns {string}
 */
export function getSummaryNoteTitle(note, defaultTitle = "Summary") {
  if (!note || typeof note !== "object") return defaultTitle;
  return (
    note.data_title ||
    note.data_tab_name ||
    note.note_title ||
    note.tab_name ||
    note.note_type ||
    note.data_type ||
    defaultTitle
  );
}
