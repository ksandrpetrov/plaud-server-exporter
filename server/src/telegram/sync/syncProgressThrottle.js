import { syncProgressHtml, syncProgressRichMarkdown } from "../messages.js";
import { editProgressBestEffort } from "./syncProgressPresenter.js";

const PROGRESS_THROTTLE_MS = 2000;
const PROGRESS_THROTTLE_LARGE_MS = 1500;
const LARGE_SYNC_TOTAL = 50;

/**
 * @param {{
 *   delivery: ReturnType<import("../streamingDelivery.js").createSyncProgressDelivery>;
 *   telegram: import("../telegramClient.js").TelegramClient;
 *   chatId: number;
 *   messageId: number | null;
 *   draftLive: boolean;
 *   nowMs: () => number;
 *   onFirstProgress?: () => void;
 * }} params
 */
export function createSyncProgressThrottle(params) {
  const {
    delivery,
    telegram,
    chatId,
    messageId,
    draftLive,
    nowMs,
    onFirstProgress,
  } = params;

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
    const progressText = syncProgressHtml(stats);
    void delivery.pushProgress({
      html: progressText,
      richMarkdown: syncProgressRichMarkdown(stats),
    });
    if (!draftLive) {
      void editProgressBestEffort({ telegram, chatId, messageId, stats });
    }
  };
}
