/**
 * `/file/temp-url/<id>` endpoint — produces a presigned audio download URL.
 *
 * @deprecated Summary-only server exporter; not wired into `runSync`.
 *   See `server/tests/syncAudioDefault.test.js`. Audio export is extension-only.
 */
import { fetchPlaudApi } from "./httpTransport.js";
import { normalizeHumanTitle, TITLE_KEYS } from "./recordingsApi.js";

function looksLikeDownloadUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  return (
    /\.(mp3|m4a|wav|opus|ogg|aac|mp4)([?#].*)?$/i.test(value) ||
    /audio|resource|download|file|object|presign|temp/i.test(value)
  );
}

function extractDownloadUrl(payload) {
  const urls = [];
  const seen = new Set();

  function walk(value) {
    if (value == null || seen.has(value)) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    Object.values(value).forEach(walk);
  }

  walk(payload);
  return urls.find(looksLikeDownloadUrl) || urls[0] || "";
}

function extractTitleHintForFile(payload, fileId) {
  const wantId = String(fileId || "").toLowerCase();
  let best = "";
  const seen = new Set();

  function walk(value, depth = 0) {
    if (depth > 14 || value == null) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    const o = value;
    const oid = String(o.file_id || o.fileId || o.id || "")
      .trim()
      .toLowerCase();
    const idMatches =
      !wantId ||
      !oid ||
      oid === wantId ||
      oid.includes(wantId) ||
      wantId.includes(oid);
    for (const key of TITLE_KEYS) {
      if (typeof o[key] !== "string") continue;
      const t = normalizeHumanTitle(o[key]);
      if (!t || t.length > 400) continue;
      if (wantId && oid && !idMatches) continue;
      if (t.length > best.length) best = t;
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  }

  walk(payload);
  return best;
}

/**
 * @returns {Promise<{ url: string; titleHint: string }>}
 */
export async function fetchAudioUrl(session, fileId) {
  const payload = await fetchPlaudApi(
    session,
    `/file/temp-url/${encodeURIComponent(fileId)}`
  );
  const url = extractDownloadUrl(payload);
  if (!url) throw new Error(`No audio URL returned for file ${fileId}`);
  return { url, titleHint: extractTitleHintForFile(payload, fileId) };
}
