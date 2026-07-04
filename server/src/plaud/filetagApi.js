import { logger } from "../logger.js";
import { fetchPlaudApi } from "./httpTransport.js";
import { mergeFiletagsById, parseFiletagListPayload } from "./plaudFolders.js";

async function fetchPlaudFiletagListWithAuth(session, authHeader) {
  const headers = authHeader ? { Authorization: authHeader } : {};
  try {
    const payload = await fetchPlaudApi(session, "/filetag/", { headers });
    return parseFiletagListPayload(payload);
  } catch {
    const payload = await fetchPlaudApi(session, "/filetag", { headers });
    return parseFiletagListPayload(payload);
  }
}

export async function fetchPlaudFiletagList(session) {
  const ua = session.userAuthHeader || session.authHeader || "";
  const wa = session.workspaceAuthHeader || "";
  const buckets = [];
  try {
    buckets.push(await fetchPlaudFiletagListWithAuth(session, ua));
  } catch (err) {
    logger.warn("recordingsApi: user-auth filetag list failed", {
      error: String(err?.message || err),
    });
    buckets.push([]);
  }
  if (wa && wa !== ua) {
    try {
      buckets.push(await fetchPlaudFiletagListWithAuth(session, wa));
    } catch (err) {
      logger.warn("recordingsApi: workspace-auth filetag list failed", {
        error: String(err?.message || err),
      });
    }
  }
  return mergeFiletagsById(buckets);
}
