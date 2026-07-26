import { syncProgressHtml, syncProgressRichMarkdown } from "../messages.js";
import { tryOpenDraft, tryOpenRichDraft } from "../streamingDelivery.js";
import { editProgressBestEffort } from "./syncProgressPresenter.js";

export const PROGRESS_THROTTLE_MS = 2000;
export const PROGRESS_THROTTLE_LARGE_MS = 1500;
export const LARGE_SYNC_TOTAL = 50;

/**
 * @param {Record<string, any>} stats
 * @returns {{ html: string; richMarkdown: string }}
 */
export function defaultSyncProgressPayload(stats) {
  return {
    html: syncProgressHtml(stats),
    richMarkdown: syncProgressRichMarkdown(stats),
  };
}

/**
 * Unified sync progress channel: throttled (manual/scheduled sync) or immediate
 * with draft bootstrap (tree quiet sync).
 *
 * @param {{
 *   mode: "throttled" | "immediate";
 *   delivery: ReturnType<typeof import("../streaming/draftChannel.js").createSyncProgressDelivery>;
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId?: number | null;
 *   draftLive?: boolean;
 *   nowMs?: () => number;
 *   onFirstProgress?: () => void;
 *   getPayload?: (stats: object) => { html: string; richMarkdown: string };
 * }} params
 */
export function createSyncProgressChannel(params) {
  const {
    mode,
    delivery,
    telegram,
    chatId,
    messageId = null,
    draftLive = false,
    nowMs = () => Date.now(),
    onFirstProgress,
    getPayload = defaultSyncProgressPayload,
  } = params;

  if (mode === "immediate") {
    return createImmediateProgressChannel({
      telegram,
      chatId,
      delivery,
      getPayload,
      onFirstProgress,
    });
  }

  return createThrottledProgressChannel({
    delivery,
    telegram,
    chatId,
    messageId,
    draftLive,
    nowMs,
    onFirstProgress,
    getPayload,
  });
}

/**
 * @param {Record<string, any>} params
 */
function createThrottledProgressChannel({
  delivery,
  telegram,
  chatId,
  messageId,
  draftLive,
  nowMs,
  onFirstProgress,
  getPayload,
}) {
  let lastEditMs = 0;
  let firstProgress = true;
  let progressThrottleMs = PROGRESS_THROTTLE_MS;

  return (stats) => {
    if (firstProgress) {
      firstProgress = false;
      onFirstProgress?.();
    }
    const total = Number(stats?.total ?? 0);
    if (total > LARGE_SYNC_TOTAL) {
      progressThrottleMs = PROGRESS_THROTTLE_LARGE_MS;
    }
    const now = nowMs();
    if (now - lastEditMs < progressThrottleMs) return;
    lastEditMs = now;
    void delivery.pushProgress(getPayload(stats));
    if (!draftLive) {
      void editProgressBestEffort({ telegram, chatId, messageId, stats });
    }
  };
}

/**
 * @param {Record<string, any>} params
 */
function createImmediateProgressChannel({
  telegram,
  chatId,
  delivery,
  getPayload,
  onFirstProgress,
}) {
  let draftActivated = false;
  let firstProgress = true;

  return async (stats) => {
    if (firstProgress) {
      firstProgress = false;
      onFirstProgress?.();
    }
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
