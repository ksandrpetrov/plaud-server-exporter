import { tryOpenDraft, tryOpenRichDraft } from "../streamingDelivery.js";

/**
 * Shared progress push handler: opens rich/text draft on first progress,
 * then streams updates through the delivery channel.
 *
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   delivery: ReturnType<import("../streamingDelivery.js").createSyncProgressDelivery>;
 *   getPayload: (stats: object) => { html: string; richMarkdown: string };
 * }} params
 * @returns {(stats: object) => Promise<void>}
 */
export function createSyncProgressPushHandler(params) {
  const { telegram, chatId, delivery, getPayload } = params;
  let draftActivated = false;

  return async (stats) => {
    const payload = getPayload(stats);
    if (!draftActivated) {
      draftActivated = true;
      const richOpened = await tryOpenRichDraft({
        telegram,
        chatId,
        draftId: delivery.draftId,
        initialMarkdown: payload.richMarkdown,
      });
      if (richOpened) {
        delivery.markRichDraftActive();
        return;
      }
      const textOpened = await tryOpenDraft({
        telegram,
        chatId,
        draftId: delivery.draftId,
        initialText: payload.html,
      });
      if (textOpened) {
        delivery.markDraftActive();
        return;
      }
    }
    await delivery.pushProgress(payload);
  };
}
