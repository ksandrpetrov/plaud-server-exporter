import {
  SYNC_LOADING_HTML,
  SYNC_LOADING_SCHEDULED_HTML,
  syncChecklistRichFrames,
  syncLoadingPulseFrames,
} from "../messages.js";
import { RICH_THINKING_MARKDOWN } from "../richFormat.js";
import {
  DraftLoadingPulse,
  LoadingPulse,
  tryOpenDraft,
  tryOpenRichDraft,
} from "../streamingDelivery.js";
import { sendOrEditLoading } from "./syncProgressPresenter.js";

const LOADING_PULSE_FRAME_MS = 900;

/**
 * @param {{
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   source: "manual" | "scheduled";
 *   loadingMessageId?: number | null;
 *   delivery: ReturnType<import("../streamingDelivery.js").createSyncProgressDelivery>;
 *   pulseFrameMs?: number;
 * }} params
 */
export async function bootstrapSyncDraftAndPulse(params) {
  const {
    telegram,
    chatId,
    source,
    delivery,
    pulseFrameMs = LOADING_PULSE_FRAME_MS,
  } = params;
  const loadingHtml =
    source === "scheduled" ? SYNC_LOADING_SCHEDULED_HTML : SYNC_LOADING_HTML;
  const draftId = delivery.draftId;
  const callbackMessageId = params.loadingMessageId ?? null;

  let draftLive = await tryOpenRichDraft({
    telegram,
    chatId,
    draftId,
    initialMarkdown: RICH_THINKING_MARKDOWN,
  });
  if (draftLive) {
    delivery.markRichDraftActive();
  } else {
    draftLive = await tryOpenDraft({
      telegram,
      chatId,
      draftId,
      initialText: "",
    });
    if (draftLive) {
      delivery.markDraftActive();
    }
  }

  let messageId = callbackMessageId;
  if (!draftLive) {
    messageId = await sendOrEditLoading({
      telegram,
      chatId,
      loadingMessageId: callbackMessageId,
      text: loadingHtml,
    });
    delivery.setLegacyMessageId(messageId);
  } else if (callbackMessageId) {
    delivery.setLegacyMessageId(callbackMessageId);
  }

  const pulseFramesHtml = syncLoadingPulseFrames(source);
  const pulseFramesRich = syncChecklistRichFrames(source);
  const pulseFrames = pulseFramesHtml.map((html, i) => ({
    html,
    richMarkdown: pulseFramesRich[i] ?? pulseFramesRich.at(-1) ?? null,
  }));

  const pulse = draftLive
    ? new DraftLoadingPulse({
        delivery,
        frames: pulseFrames,
        frameMs: pulseFrameMs,
      })
    : new LoadingPulse({
        telegram,
        chatId,
        messageId,
        frames: pulseFramesHtml,
        frameMs: pulseFrameMs,
      });
  pulse.start();

  return { draftLive, messageId, pulse };
}

export { LOADING_PULSE_FRAME_MS };
