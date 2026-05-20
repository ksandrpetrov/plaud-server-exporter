/**
 * Plaud API barrel. Splits across focused modules; this file re-exports the
 * subset actually used by the server (summary-only sync) so existing imports
 * across `server/src/` and tests keep working. Prefer importing from the leaf
 * modules in new code.
 *
 *  - `errors.js`         — domain error classes (`PlaudAuthError`, `PlaudChangedError`)
 *  - `httpTransport.js`  — fetch, retries, region redirect, headers
 *  - `recordingsApi.js`  — list recordings, filetags, session validation
 *  - `summariesApi.js`   — `/ai/query_note` + markdown extraction
 *  - `audioApi.js`       — `/file/temp-url/<id>` presigned download URL
 *
 * `audioApi.fetchAudioUrl` is intentionally NOT re-exported here: the server
 * sync path is summary-only (see `syncAudioDefault.test.js`). Import it
 * directly from `./audioApi.js` if you genuinely need audio.
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
