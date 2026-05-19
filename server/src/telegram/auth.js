/**
 * Single-user authorization for the Telegram bot.
 *
 * The allowed username is configured via `TELEGRAM_ALLOWED_USERNAME` (no `@`,
 * case-insensitive). `/start` and `/help` are open to everyone so that
 * accidental tappers get a polite "this is private" message instead of silence.
 * Every other command and callback from a foreign account is silently ignored
 * — the same pattern as satellite's USER_CALENDAR_MAP gate in
 * `satellite/satellite/telegram_bot/handlers.py:274`.
 */

export function normalizeUsername(raw) {
  if (raw == null) return "";
  return String(raw).trim().replace(/^@/, "").toLowerCase();
}

export function isAllowedUsername(actualUsername, allowedUsername) {
  if (!allowedUsername) return false;
  const actual = normalizeUsername(actualUsername);
  if (!actual) return false;
  return actual === normalizeUsername(allowedUsername);
}

/**
 * Extract the username from a Telegram `message`/`callback_query` payload.
 *
 * @param {object | null | undefined} from
 * @returns {string}
 */
export function usernameFromPayload(from) {
  if (!from || typeof from !== "object") return "";
  return normalizeUsername(from.username);
}
