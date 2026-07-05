const TELEGRAM_METHOD_UNAVAILABLE_MARKERS = [
  "method is not found",
  "method not found",
  "unknown method",
  "not implemented",
];

const DRAFT_UNAVAILABLE_MARKERS = [
  "sendmessagedraft",
  "textdraft",
  ...TELEGRAM_METHOD_UNAVAILABLE_MARKERS,
];

const RICH_UNAVAILABLE_MARKERS = [
  "sendrichmessage",
  "sendrichmessagedraft",
  "rich_message",
  "richmessage",
  ...TELEGRAM_METHOD_UNAVAILABLE_MARKERS,
];

const EMPTY_TEXT_REJECTED_MARKERS = [
  "text is empty",
  "message text is empty",
  "text must be non-empty",
];

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorText(err) {
  return String(/** @type {any} */ (err)?.message || err).toLowerCase();
}

/**
 * @param {string} text
 * @param {readonly string[]} markers
 * @returns {boolean}
 */
function matchesAny(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isDraftUnavailable(err) {
  return matchesAny(errorText(err), DRAFT_UNAVAILABLE_MARKERS);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRichMessageUnavailable(err) {
  return matchesAny(errorText(err), RICH_UNAVAILABLE_MARKERS);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isEmptyTextRejected(err) {
  return matchesAny(errorText(err), EMPTY_TEXT_REJECTED_MARKERS);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isHtmlEntitiesRejected(err) {
  const text = errorText(err);
  return (
    text.includes("can't parse entities") ||
    text.includes("cant parse entities") ||
    (text.includes("expandable") && text.includes("blockquote"))
  );
}
