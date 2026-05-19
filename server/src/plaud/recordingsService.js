import { listAllRecordings, fetchSummaries, fetchAudioUrl } from "./plaudApiClient.js";

/**
 * Thin orchestration wrapper. Today this is just the API client; if/when we
 * add merging with local DOM/cache scans, this is the place to do it.
 */
export const recordingsService = {
  list: (session, options) => listAllRecordings(session, options),
  summaries: (session, file) => fetchSummaries(session, file),
  audioUrl: (session, fileId) => fetchAudioUrl(session, fileId),
};
