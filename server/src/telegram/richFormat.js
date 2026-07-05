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
