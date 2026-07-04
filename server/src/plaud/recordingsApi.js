/**
 * Endpoints that deal with the recordings list, filetags (folders), per-file
 * audio URLs, and a cheap session validator. All HTTP plumbing lives in
 * `httpTransport.js`; this module focuses on Plaud's quirky response shapes
 * and the per-folder fan-out the bot/CLI need to discover every recording.
 */
import { fetchPlaudApi } from "./httpTransport.js";
import { validateOfficialSession } from "./officialPlaudApi.js";
import { normalizePlaudRecording } from "../../../browser-extension/common/plaudRecordings.js";
import { findFileArray, listAllRecordingsSimple } from "./recordingsList.js";

export {
  TITLE_KEYS,
  normalizeHumanTitle,
} from "../../../browser-extension/common/plaudTitles.js";

export { normalizePlaudRecording as normalizePlaudFile };
export { fetchPlaudFiletagList } from "./filetagApi.js";
export {
  listAllRecordings,
  listAllRecordingsSimple,
  findFileArray,
} from "./recordingsList.js";

/**
 * Lightweight recordings pull for the Telegram bot's "Дерево синка" view:
 * global non-trash + trash listings without per-folder fan-out.
 * Folder segments are resolved by `liveTreeReadModel` from its own tag fetch.
 */
export async function listRecordingsForBotTree(session, options = {}) {
  return listAllRecordingsSimple(session, {
    includeTrash: true,
    skipFolderEnrichment: true,
    ...options,
  });
}

/**
 * Cheap connectivity check — used at the end of `server:auth` to fail fast if
 * the snapshot does not actually work. Returns the number of items returned.
 */
export async function validateSession(session) {
  if (session?.apiMode === "official") {
    return validateOfficialSession(session);
  }
  const payload = await fetchPlaudApi(
    session,
    `/file/simple/web?${new URLSearchParams({
      skip: "0",
      limit: "1",
      sort_by: session.sortBy || "start_time",
      is_desc: "true",
      r: String(Math.random()),
      is_trash: "0",
    }).toString()}`
  );
  const arr = findFileArray(payload);
  return arr.length;
}
