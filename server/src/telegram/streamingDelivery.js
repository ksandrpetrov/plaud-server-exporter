/**
 * Streaming sync progress via sendMessageDraft with legacy edit fallback.
 * Implementation split under `streaming/`; this file re-exports the public API.
 */

export { clipTelegramText, safeSliceHtml } from "./messages/format.js";

export {
  createSyncProgressDelivery,
  DraftLoadingPulse,
  isDraftUnavailable,
  stableDraftId,
  tryOpenDraft,
} from "./streaming/draftChannel.js";

export {
  buildTypewriterFrames,
  runDraftTypewriterPreview,
  TYPEWRITER_FRAME_MS,
  TYPEWRITER_MAX_FRAMES,
  TYPEWRITER_MIN_CHUNK,
  TYPEWRITER_MIN_LEN,
  typewriterChunks,
  typewriterDraftAnimate,
  typewriterReveal,
} from "./streaming/typewriter.js";

export { LoadingPulse } from "./streaming/loadingPulse.js";
