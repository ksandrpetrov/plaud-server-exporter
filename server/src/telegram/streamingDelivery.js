/**
 * Streaming sync progress via sendMessageDraft with legacy edit fallback.
 * Implementation split under `streaming/`; this file re-exports the public API.
 */

export { clipTelegramText, safeSliceHtml } from "./messages/format.js";

export {
  createSyncProgressDelivery,
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
