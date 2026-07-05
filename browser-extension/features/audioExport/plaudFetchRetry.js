/**
 * @param {unknown} error
 * @param {number} [httpStatusFromMessage]
 * @returns {boolean}
 */
export function shouldRetryPlaudFetchAttempt(error, httpStatusFromMessage) {
  const msg = String(error?.message || error || "");
  if (/\bHTTP\s+401\b/.test(msg) || /\bHTTP\s+403\b/.test(msg)) {
    return false;
  }
  if (error?.name === "AbortError") return true;
  if (/таймаут запроса к API Plaud/i.test(msg)) return true;
  if (
    /\bHTTP\s+429\b/.test(msg) ||
    /\bHTTP\s+502\b/.test(msg) ||
    /\bHTTP\s+503\b/.test(msg) ||
    /\bHTTP\s+504\b/.test(msg)
  ) {
    return true;
  }
  if (
    /Failed to fetch/i.test(msg) ||
    /NetworkError/i.test(msg) ||
    /network request failed/i.test(msg) ||
    /Load failed/i.test(msg)
  ) {
    return true;
  }
  if (
    httpStatusFromMessage &&
    [429, 502, 503, 504].includes(httpStatusFromMessage)
  ) {
    return true;
  }
  return false;
}
