/**
 * Single-user authorization for the Telegram bot.
 *
 * The bot is locked down to one human in one private chat. We layer three
 * independent checks before any handler does work:
 *
 * 1. `chat.type === "private"` — refuse to operate in groups/channels even if
 *    the right user happens to send a message there. Group chat ids would
 *    otherwise leak into `owner-chat.json` and the scheduler would broadcast
 *    summaries to every group member.
 * 2. `from.id === TELEGRAM_ALLOWED_USER_ID` — Telegram user ids are immutable;
 *    usernames are not (they can be released and re-claimed by anyone).
 *    The numeric id is the primary trust anchor.
 * 3. `from.username === TELEGRAM_ALLOWED_USERNAME` (optional, defence in
 *    depth) — when configured, both must match. If only `username` is set
 *    we keep that check working for legacy installs, but `runBot()` logs a
 *    warning recommending the operator add the user id.
 *
 * Every check is silent on failure: foreign senders see no reply at all.
 * `auth.js` is pure — no Telegram I/O — so it stays trivial to unit-test.
 */

export function normalizeUsername(raw) {
  if (raw == null) return "";
  return String(raw).trim().replace(/^@/, "").toLowerCase();
}

/**
 * @param {number | string | null | undefined} raw
 * @returns {number | null}
 */
export function normalizeUserId(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * @param {object | null | undefined} from
 * @returns {string}
 */
export function usernameFromPayload(from) {
  if (!from || typeof from !== "object") return "";
  return normalizeUsername(from.username);
}

/**
 * @param {object | null | undefined} from
 * @returns {number | null}
 */
export function userIdFromPayload(from) {
  if (!from || typeof from !== "object") return null;
  return normalizeUserId(from.id);
}

/**
 * @param {object | null | undefined} chat
 * @returns {boolean}
 */
export function isPrivateChat(chat) {
  if (!chat || typeof chat !== "object") return false;
  return String(chat.type || "") === "private";
}

/**
 * Returns true only when every configured check matches. At least one of
 * `allowedUserId` / `allowedUsername` must be configured — `runBot()`
 * already refuses to start without them, so reaching this with both empty
 * is a programmer error and we conservatively deny.
 *
 * @param {{
 *   from: object | null | undefined;
 *   allowedUserId: number | null | undefined;
 *   allowedUsername: string | null | undefined;
 * }} params
 */
export function isAllowedSender({ from, allowedUserId, allowedUsername }) {
  const userId = userIdFromPayload(from);
  const username = usernameFromPayload(from);
  const expectedId = normalizeUserId(allowedUserId);
  const expectedUsername = normalizeUsername(allowedUsername);

  if (!expectedId && !expectedUsername) return false;

  if (expectedId != null) {
    if (userId !== expectedId) return false;
  }
  if (expectedUsername) {
    if (!username || username !== expectedUsername) return false;
  }
  return true;
}

/**
 * Legacy helper kept for tests that pin down username normalization
 * semantics independently of the chat-type / user-id gate.
 *
 * @param {string | null | undefined} actualUsername
 * @param {string | null | undefined} allowedUsername
 */
export function isAllowedUsername(actualUsername, allowedUsername) {
  if (!allowedUsername) return false;
  const actual = normalizeUsername(actualUsername);
  if (!actual) return false;
  return actual === normalizeUsername(allowedUsername);
}

/**
 * Combined private-chat + allowed-sender gate used by message and callback dispatch.
 *
 * @param {{
 *   allowedUserId: number | null | undefined;
 *   allowedUsername: string | null | undefined;
 * }} ctx
 * @param {{ chat: object | null | undefined; from: object | null | undefined }} payload
 */
export function isAuthorizedPrivateUpdate(ctx, { chat, from }) {
  if (!isPrivateChat(chat)) return false;
  return isAllowedSender({
    from,
    allowedUserId: ctx.allowedUserId,
    allowedUsername: ctx.allowedUsername,
  });
}
