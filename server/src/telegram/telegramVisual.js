/**
 * Telegram visual polish: typing indicator and message effects (satellite visual.py).
 */

/** ✨ sparkles — Bot API message_effect_id */
export const EFFECT_SPARKLES = "5089460564141278042";

const CHAT_ACTION_REFRESH_MS = 4000;

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
  const text = String(err?.message || err).toLowerCase();
  return (
    text.includes("message_effect") || text.includes("premium_account_required")
  );
}

/**
 * Keeps the typing indicator alive during long operations.
 */
export class TypingIndicator {
  /**
   * @param {{
   *   telegram: import("./telegramClient.js").TelegramClient;
   *   chatId: number;
   *   nowMs?: () => number;
   * }} params
   */
  constructor({ telegram, chatId, nowMs = () => Date.now() }) {
    this._telegram = telegram;
    this._chatId = chatId;
    this._now = nowMs;
    this._timer = null;
    this._lastPingMs = 0;
  }

  start() {
    void this._ping();
    this._timer = setInterval(() => {
      void this._ping();
    }, CHAT_ACTION_REFRESH_MS);
    if (typeof this._timer.unref === "function") {
      this._timer.unref();
    }
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _ping() {
    const now = this._now();
    if (now - this._lastPingMs < CHAT_ACTION_REFRESH_MS - 200) return;
    this._lastPingMs = now;
    try {
      await this._telegram.sendChatAction({ chatId: this._chatId, action: "typing" });
    } catch {
      // best-effort
    }
  }
}
