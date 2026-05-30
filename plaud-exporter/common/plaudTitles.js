/**
 * Shared Plaud recording title normalization (server + extension).
 */

export const TITLE_KEYS = [
  "file_name",
  "filename",
  "fileName",
  "file_title",
  "fileTitle",
  "name",
  "title",
  "display_name",
  "displayName",
  "audio_name",
  "recording_name",
  "topic",
  "recordingTitle",
];

/** @type {Set<string>} */
export const PLAUD_TITLE_KEYS = new Set(TITLE_KEYS);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHumanTitle(value) {
  let s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      const decoded = decodeURIComponent(s).replace(/\s+/g, " ").trim();
      if (decoded) s = decoded;
    } catch {
      // ignore
    }
  }
  return s;
}

/**
 * First non-empty title field from a Plaud file object.
 *
 * @param {Record<string, unknown> | null | undefined} rawFile
 * @returns {string}
 */
export function pickRawTitleFromFile(rawFile) {
  if (!rawFile || typeof rawFile !== "object") return "";
  const hit = TITLE_KEYS.map((k) => rawFile[k]).find(
    (v) => typeof v === "string" && v.trim()
  );
  return typeof hit === "string" ? hit : "";
}
