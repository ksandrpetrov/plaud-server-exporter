import { isHtmlEntitiesRejected } from "./apiFallback.js";
import { stripUnsupportedHtml } from "./htmlFormat.js";
import { isMessageEffectRejected } from "./telegramVisual.js";
import { TelegramError } from "./transport/telegramErrors.js";

/**
 * Retry send/edit when Telegram rejects HTML entities or message effects.
 *
 * @param {{
 *   err: unknown;
 *   text: string;
 *   buildData: (text: string, options?: { dropEffect?: boolean }) => object;
 *   retry: (data: object) => Promise<unknown>;
 * }} params
 */
export async function retrySendOrEditAfterTelegramReject({
  err,
  text,
  buildData,
  retry,
}) {
  if (!(err instanceof TelegramError)) throw err;
  if (isHtmlEntitiesRejected(err)) {
    const stripped = stripUnsupportedHtml(text);
    if (stripped !== text) {
      return retry(buildData(stripped));
    }
  }
  if (isMessageEffectRejected(err)) {
    return retry(buildData(text, { dropEffect: true }));
  }
  throw err;
}

/**
 * @param {{
 *   err: unknown;
 *   markdown: string;
 *   buildData: (markdown: string, options?: { dropEffect?: boolean }) => object;
 *   retry: (data: object) => Promise<unknown>;
 * }} params
 */
export async function retryRichSendAfterTelegramReject({
  err,
  markdown,
  buildData,
  retry,
}) {
  if (!(err instanceof TelegramError)) throw err;
  if (isMessageEffectRejected(err)) {
    return retry(buildData(markdown, { dropEffect: true }));
  }
  throw err;
}
