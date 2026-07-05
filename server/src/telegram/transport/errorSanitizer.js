import { TELEGRAM_API } from "./constants.js";

/**
 * @param {string} token
 * @param {string} baseUrl
 * @returns {(text: string) => string}
 */
export function createTelegramErrorSanitizer(token, baseUrl) {
  return function sanitize(text) {
    if (!text) return text;
    let safe = String(text);
    if (token) {
      safe = safe.split(token).join("<telegram-token>");
    }
    safe = safe.split(baseUrl).join(`${TELEGRAM_API}/bot<telegram-token>`);
    return safe;
  };
}
