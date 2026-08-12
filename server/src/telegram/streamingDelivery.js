/**
 * Прогресс синка: rich-черновик → текстовый черновик → правка сообщения.
 * Implementation split under `streaming/`; this file re-exports the public API.
 */

export { clipTelegramText, safeSliceHtml } from "./messages/format.js";

export {
  createSyncProgressDelivery,
  dismissDraftBubbleBestEffort,
  DraftLoadingPulse,
  isDraftUnavailable,
  isEmptyTextRejected,
  stableDraftId,
  tryOpenDraft,
  tryOpenRichDraft,
} from "./streaming/draftChannel.js";

export {
  runDraftThinkingPreview,
  THINKING_HOLD_MS,
  THINKING_PREVIEW_MIN_LEN,
  tryPushThinkingDraft,
  withThinkingDraft,
} from "./streaming/thinkingDraft.js";

export { LoadingPulse } from "./streaming/loadingPulse.js";
