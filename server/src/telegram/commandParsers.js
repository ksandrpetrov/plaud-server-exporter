/**
 * Pure parsers for the bot's command vocabulary. Recognizes `/start`,
 * `/help`, `/menu`, `/status` with optional bot-suffix (`/menu@PlaudBot`)
 * and trailing free-text. Kept dependency-free so unit tests can import
 * them in isolation.
 */

const COMMAND_HEAD = (raw) =>
  String(raw || "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
const COMMAND_RE = (name) => new RegExp(`^/${name}(?:@[a-z0-9_]+)?$`);

/**
 * Returns a short, log-safe label for the incoming message: the first
 * `/command` token if any, otherwise the literal `text` truncated to 32
 * chars. We only log this for foreign senders, so it never contains the
 * owner's free-text input.
 *
 * @param {string} text
 * @returns {string}
 */
export function extractCommandName(text) {
  const head = COMMAND_HEAD(text);
  if (head.startsWith("/")) return head.slice(0, 32);
  return String(text || "").slice(0, 32);
}

export function isStartCommand(text) {
  return COMMAND_RE("start").test(COMMAND_HEAD(text));
}

export function isHelpCommand(text) {
  return COMMAND_RE("help").test(COMMAND_HEAD(text));
}

export function isMenuCommand(text) {
  return COMMAND_RE("menu").test(COMMAND_HEAD(text));
}

export function isStatusCommand(text) {
  return COMMAND_RE("status").test(COMMAND_HEAD(text));
}
