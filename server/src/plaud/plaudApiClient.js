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
 *
 * Server sync is summary-only; it never calls `/file/temp-url` (see
 * `syncAudioDefault.test.js`).
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
