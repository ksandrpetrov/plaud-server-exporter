/**
 * Rich message (Bot API 10.1) helpers — markdown transport layer.
 *
 * Telegram accepts GFM-markdown up to 32 768 chars (~500 blocks). We clip
 * conservatively at RICH_MARKDOWN_MAX_LEN on line boundaries.
 */

export { isRichMessageUnavailable } from "./apiFallback.js";

/** @type {number} */
export const RICH_MARKDOWN_MAX_LEN = 30000;

/**
 * Bot API 10.1 `RichBlockThinking` — native "Thinking…" placeholder for
 * `sendRichMessageDraft`. Draft-only: never appears in persisted messages.
 */
export const RICH_THINKING_MARKDOWN = "<tg-thinking></tg-thinking>";

const UTF8_BOM = "\uFEFF";

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
 * Splits Markdown into non-empty chunks without discarding content. Prefers
 * paragraph and line boundaries; a single oversized line is hard-split.
 *
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function splitRichMarkdown(text, maxLen = RICH_MARKDOWN_MAX_LEN) {
  const limit = Math.max(1, Math.floor(Number(maxLen) || 0));
  let remaining = String(text ?? "");
  const chunks = [];

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) {
      cut = window.lastIndexOf("\n", limit);
    }
    if (cut < limit * 0.5) {
      cut = Math.max(
        window.lastIndexOf(" ", limit),
        window.lastIndexOf("\t", limit)
      );
    }
    if (cut < limit * 0.5) {
      cut = limit;
    }

    const chunk = remaining.slice(0, cut).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }

  const tail = remaining.trimEnd();
  if (tail) chunks.push(tail);
  return chunks;
}
