/**
 * Recovers Plaud recording IDs from places the public API misses:
 *
 *   - DOM table rows / links rendered by Plaud Web
 *   - `pld_*` snapshots cached by the SPA in localStorage / sessionStorage
 *
 * Used to widen the `runSmartSync` candidate set so manually trashed or
 * partially loaded recordings still get reconciled. Pure data extraction —
 * no fetch, no Chrome APIs.
 */

import {
  collectDomRecordingHexIds,
  extractRawRecordingId,
  normalizeHexRecordingId,
} from "../../common/plaudRecordingIds.js";

export { extractRawRecordingId } from "../../common/plaudRecordingIds.js";

/**
 * Adds entries for ids that we see in the DOM but not in the API response.
 * Returned counters feed sync diagnostics.
 *
 * @param {PlaudRecording[]} files
 * @param {{ unfiledLabel: string }} options
 */
export function mergeDomRecordingIdsIntoFiles(files, { unfiledLabel }) {
  const domIds = collectDomRecordingHexIds();
  const seenIds = new Set(
    files.map(
      (f) => normalizeHexRecordingId(f.id) || String(f.id || "").toLowerCase()
    )
  );
  let domMerged = 0;
  for (const hid of domIds) {
    const id = String(hid).toLowerCase();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    files.push({
      id,
      title: id,
      raw: { file_id: id },
      folderIds: [],
      folderSegment: unfiledLabel,
    });
    domMerged++;
  }
  return { domMerged, domSeen: domIds.length };
}

/**
 * A cached recording-row in Plaud Web's storage is an object with a recording
 * id AND at least one other recording-like field. Naked `{id: "..."}`
 * objects (e.g. tag references) are intentionally rejected.
 */
function looksLikeCachedRecordingRow(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const id = normalizeHexRecordingId(extractRawRecordingId(o));
  if (!id) return false;

  const keys = Object.keys(o);
  if (
    keys.length <= 3 &&
    keys.every((k) => /^(id|file_id|fileId|fileID)$/i.test(k))
  ) {
    return false;
  }

  return keys.some((k) =>
    /file|record|audio|note|summary|transcript|duration|time|trash|tag|folder|upload|title|name|topic|display|workspace/i.test(
      k
    )
  );
}

function collectRecordingIdsFromPlaudWebStorage(storage, maxKeys) {
  if (storage == null || typeof storage.key !== "function") return [];

  const ids = new Set();
  const visited = new WeakSet();

  function walk(value, depth) {
    if (depth > 18 || value == null) return;
    if (typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }

    if (looksLikeCachedRecordingRow(value)) {
      const nid = normalizeHexRecordingId(extractRawRecordingId(value));
      if (nid) ids.add(nid);
    }

    for (const v of Object.values(value)) walk(v, depth + 1);
  }

  let scannedKeys = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.includes("pld")) continue;
      scannedKeys++;
      if (scannedKeys > maxKeys) break;

      const raw = storage.getItem(key);
      if (!raw || raw.length > 3_500_000) continue;
      try {
        walk(JSON.parse(raw), 0);
      } catch {
        // not JSON, skip
      }
    }
  } catch {
    return [...ids];
  }

  return [...ids];
}

function collectRecordingIdsFromPlaudLocalStorage() {
  if (typeof localStorage === "undefined") return [];
  return collectRecordingIdsFromPlaudWebStorage(localStorage, 400);
}

function collectRecordingIdsFromPlaudSessionStorage() {
  if (typeof sessionStorage === "undefined") return [];
  return collectRecordingIdsFromPlaudWebStorage(sessionStorage, 220);
}

const MAX_EXTRA_FROM_CACHE = 192;

/**
 * Adds entries for ids cached in Plaud Web's localStorage / sessionStorage
 * that aren't in the API response (Plaud caches trimmed metadata locally).
 *
 * @param {PlaudRecording[]} files
 * @param {{ maxExtraFromCache?: number }} [options]
 */
export function mergeLocalStorageRecordingIdsIntoFiles(files, options = {}) {
  const lsIds = collectRecordingIdsFromPlaudLocalStorage();
  const ssIds = collectRecordingIdsFromPlaudSessionStorage();
  const combined = [...new Set([...lsIds, ...ssIds])];

  const seenIds = new Set(
    files.map(
      (f) => normalizeHexRecordingId(f.id) || String(f.id || "").toLowerCase()
    )
  );
  let lsMerged = 0;
  const maxExtraRaw = Number(options.maxExtraFromCache);
  const maxExtra =
    Number.isFinite(maxExtraRaw) && maxExtraRaw >= 0
      ? Math.floor(maxExtraRaw)
      : MAX_EXTRA_FROM_CACHE;
  for (const hid of combined) {
    if (lsMerged >= maxExtra) break;
    const id = String(hid).toLowerCase();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    files.push({
      id,
      title: id,
      raw: { file_id: id },
    });
    lsMerged++;
  }
  return {
    lsMerged,
    lsSeen: combined.length,
    lsFromLocal: lsIds.length,
    ssFromSession: ssIds.length,
  };
}
