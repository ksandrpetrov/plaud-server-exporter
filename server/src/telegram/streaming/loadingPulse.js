/**
 * Анимация загрузки в чате через `editMessageText` — `edit`-ярус доставки.
 *
 * Используется, когда `bootstrapSyncDraftAndPulse` не смог открыть черновик
 * (`draftLive === false`). Это не старый код: открытие черновика падает на
 * любой сетевой ошибке, а не только на отсутствии метода в Bot API, — см.
 * шапку `streaming/draftChannel.js`. Draft-путь — `DraftLoadingPulse` там же.
 */

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId: number | null;
 *   frames: string[];
 *   frameMs?: number;
 * }} params
 */
export class LoadingPulse {
  constructor({ telegram, chatId, messageId, frames, frameMs = 1400 }) {
    this._telegram = telegram;
    this._chatId = chatId;
    this._messageId = messageId;
    this._frames = frames.length > 0 ? frames : null;
    this._frameMs = frameMs;
    this._timer = null;
    this._idx = 0;
    this._inflight = false;
    this._stopped = true;
  }

  start() {
    if (!this._frames || !this._messageId) return;
    this._stopped = false;
    this._timer = setInterval(() => {
      void this._tick();
    }, this._frameMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  stop() {
    this._stopped = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _tick() {
    if (this._stopped || this._inflight) return;
    this._inflight = true;
    this._idx = (this._idx + 1) % this._frames.length;
    const text = this._frames[this._idx];
    try {
      await this._telegram.editMessageText({
        chatId: this._chatId,
        messageId: this._messageId,
        text,
        replyMarkup: null,
      });
    } catch {
      // best-effort
    } finally {
      this._inflight = false;
    }
  }
}
