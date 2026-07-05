/**
 * HTML helpers for Telegram messages (mirrors satellite html_format.py).
 */

/**
 * @param {string} text
 * @returns {string}
 */
export function blockquote(text) {
  return `<blockquote>${text}</blockquote>`;
}

/**
 * Wraps multi-line bodies in a blockquote when they exceed `threshold` lines.
 *
 * @param {string} text
 * @param {{ threshold?: number }} [options]
 * @returns {string}
 */
export function expandableBlockquote(text, options = {}) {
  const threshold = options.threshold ?? 3;
  const body = String(text ?? "");
  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < threshold) return body;
  return blockquote(body);
}

/**
 * Strips expandable blockquote attributes for Telegram HTML retry.
 *
 * @param {string} htmlText
 * @returns {string}
 */
export function stripExpandableBlockquote(htmlText) {
  return String(htmlText ?? "").replace(
    /<blockquote\s+expandable="true">/gi,
    "<blockquote>"
  );
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export { isHtmlEntitiesRejected } from "./apiFallback.js";

/**
 * @param {string} htmlText
 * @returns {string}
 */
export function stripBlockquotes(htmlText) {
  return String(htmlText ?? "")
    .replace(/<blockquote[^>]*>/gi, "")
    .replace(/<\/blockquote>/gi, "");
}

/**
 * @param {string} htmlText
 * @returns {string}
 */
export function stripUnsupportedHtml(htmlText) {
  return stripBlockquotes(stripExpandableBlockquote(htmlText));
}
