/**
 * Telegram visual polish: message effects (satellite visual.py).
 */

/** ✨ sparkles — Bot API message_effect_id */
export const EFFECT_SPARKLES = "5089460564141278042";

/**
 * Telegram uses positive chat ids for one-to-one chats and negative ids for
 * groups/channels. We only enable message effects in the former; the helper
 * is named after the `chatId` shape, not the `chat.type` field that
 * `auth.js::isPrivateChat` checks — keeping the two helpers distinguishable
 * by signature avoids a footgun where one is imported in place of the other.
 *
 * @param {number | null | undefined} chatId
 * @returns {boolean}
 */
export function isOneToOneChatId(chatId) {
  return Number.isInteger(chatId) && chatId > 0;
}

/**
 * @param {string | null | undefined} effectId
 * @param {number} chatId
 * @returns {string | undefined}
 */
export function privateMessageEffect(effectId, chatId) {
  if (effectId && isOneToOneChatId(chatId)) return effectId;
  return undefined;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMessageEffectRejected(err) {
  const text = String(/** @type {any} */ (err)?.message || err).toLowerCase();
  return (
    text.includes("message_effect") || text.includes("premium_account_required")
  );
}
