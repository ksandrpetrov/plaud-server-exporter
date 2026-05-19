/**
 * Plaud API barrel. Splits across four focused modules; this file exists
 * for backward compatibility with existing imports across `server/src/` and
 * tests. Prefer importing from the leaf modules in new code.
 *
 *  - `errors.js`         — domain error classes (`PlaudAuthError`, `PlaudChangedError`)
 *  - `httpTransport.js`  — fetch, retries, region redirect, headers
 *  - `recordingsApi.js`  — list recordings, filetags, session validation
 *  - `summariesApi.js`   — `/ai/query_note` + markdown extraction
 *  - `audioApi.js`       — `/file/temp-url/<id>` presigned download URL
 */
export { PlaudAuthError, PlaudChangedError } from "./errors.js";
export { fetchPlaudApi, fetchUrlTextWithRetries } from "./httpTransport.js";
export {
  TITLE_KEYS,
  fetchPlaudFiletagList,
  listAllRecordings,
  listRecordingsForBotTree,
  normalizeHumanTitle,
  normalizePlaudFile,
  validateSession,
} from "./recordingsApi.js";
export { fetchSummaries, stripPlaudInlineAssets } from "./summariesApi.js";
export { fetchAudioUrl } from "./audioApi.js";
