/**
 * Rich message (Bot API 10.1) helpers — markdown transport layer.
 *
 * Telegram accepts GFM-markdown up to 32 768 chars (~500 blocks). We clip
 * conservatively at RICH_MARKDOWN_MAX_LEN on line boundaries.
 */

/** @type {number} */
export const RICH_MARKDOWN_MAX_LEN = 30000;

const RICH_UNAVAILABLE_MARKERS = [
  "sendrichmessage",
  "sendrichmessagedraft",
  "rich_message",
  "richmessage",
  "method is not found",
  "method not found",
  "unknown method",
  "not implemented",
];

const UTF8_BOM = "\uFEFF";

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRichMessageUnavailable(err) {
  const text = String(/** @type {any} */ (err)?.message || err).toLowerCase();
  return RICH_UNAVAILABLE_MARKERS.some((m) => text.includes(m));
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripUtf8Bom(text) {
  const raw = String(text ?? "");
  return raw.startsWith(UTF8_BOM) ? raw.slice(UTF8_BOM.length) : raw;
}

/**
 * Clips markdown on a line boundary so tables/blocks are not split mid-row.
 *
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
export function clipRichMarkdown(text, maxLen = RICH_MARKDOWN_MAX_LEN) {
  const raw = String(text ?? "");
  if (raw.length <= maxLen) return raw;
  const slice = raw.slice(0, maxLen);
  const lastNewline = slice.lastIndexOf("\n");
  if (lastNewline > maxLen * 0.5) {
    return slice.slice(0, lastNewline).trimEnd();
  }
  return slice.trimEnd();
}

/**
 * @param {{ markdown?: string; title?: string }} params
 * @returns {string}
 */
export function prepareSummaryRichMarkdown({ markdown, title }) {
  let body = stripUtf8Bom(String(markdown ?? "")).trim();
  const heading = String(title ?? "").trim();
  const hasTopHeading = /^#\s[^#]/.test(body);
  if (heading && !hasTopHeading) {
    body = `# ${heading}\n\n${body}`;
  }
  return clipRichMarkdown(body);
}
