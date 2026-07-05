/**
 * Shared Plaud recording title normalization (server + extension).
 */

import {
  RAW_FILE_ID_RE,
  normalizeHexRecordingId,
} from "./plaudRecordingIds.js";

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
  let s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function isPlausibleRecordingTitle(text) {
  const s = String(text || "").trim();
  if (!s || s.length > 400) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (RAW_FILE_ID_RE.test(s)) return false;
  return true;
}

/**
 * Ищет в ответе API (в т.ч. /file/temp-url) строку с именем записи для fileId.
 *
 * @param {unknown} payload
 * @param {string} fileId
 * @returns {string}
 */
export function extractTitleForFileFromPayload(payload, fileId) {
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

    for (const key of PLAUD_TITLE_KEYS) {
      if (typeof o[key] !== "string") continue;
      const t = normalizeHumanTitle(o[key]);
      if (!isPlausibleRecordingTitle(t)) continue;
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
 * @param {unknown} title
 * @param {unknown} fileId
 * @returns {boolean}
 */
export function titleLooksLikeRawId(title, fileId) {
  const t = normalizeHumanTitle(title);
  const id = normalizeHexRecordingId(fileId) || String(fileId || "").trim();
  const titleId = normalizeHexRecordingId(t);
  if (!t || t === id || (titleId && titleId === id)) return true;
  if (RAW_FILE_ID_RE.test(t)) return true;
  return false;
}

/**
 * @param {{ title?: string, id?: string } & Record<string, unknown>} file
 * @param {unknown} titleHint
 */
export function preferApiTitle(file, titleHint) {
  const hint = normalizeHumanTitle(titleHint);
  if (!hint || !isPlausibleRecordingTitle(hint)) return file;
  if (titleLooksLikeRawId(file.title, file.id)) {
    return { ...file, title: hint };
  }
  const current = normalizeHumanTitle(file.title);
  if (hint.length >= current.length + 3) {
    return { ...file, title: hint };
  }
  return file;
}
