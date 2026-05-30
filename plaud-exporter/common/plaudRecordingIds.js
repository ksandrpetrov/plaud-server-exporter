/** 32 hex chars — Plaud file/recording id in API, URL, and data-* attributes. */
export const RAW_FILE_ID_RE = /^[a-f0-9]{32}$/i;

/** Object keys Plaud uses for recording ids (API payloads, cache blobs). */
export const RECORDING_ID_KEYS = [
  "file_id",
  "fileId",
  "id",
  "recording_id",
  "recordingId",
  "audio_id",
  "audioId",
  "resource_id",
  "resourceId",
  "uuid",
];

/** Best-effort id pull from any Plaud payload object. */
export function extractRawRecordingId(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  for (const key of RECORDING_ID_KEYS) {
    const value = raw[key];
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return "";
}

/**
 * Canonical id for sync/index: lowercase 32-hex when possible, else trimmed raw id.
 */
export function normalizePlaudRecordingId(raw) {
  const extracted = extractRawRecordingId(raw);
  if (!extracted) return "";
  const hex = normalizeHexRecordingId(extracted);
  return hex || extracted;
}

/** 32 hex without dashes — aligns UUID from API/cache with DOM. */
export function normalizeHexRecordingId(rawId) {
  const s = String(rawId ?? "").trim();
  if (!s) return "";
  const compact = s.replace(/-/g, "").toLowerCase();
  if (compact.length === 32 && RAW_FILE_ID_RE.test(compact)) return compact;
  if (RAW_FILE_ID_RE.test(s)) return s.toLowerCase();
  return "";
}

/**
 * Scans the current document for 32-hex recording ids (data attributes, /file/ links).
 * @returns {string[]} Lowercase hex ids
 */
export function collectDomRecordingHexIds() {
  if (typeof document === "undefined" || !document.querySelectorAll) {
    return [];
  }
  const ids = new Set();
  /** @param {string | null | undefined} s */
  function addHex32(s) {
    if (typeof s !== "string") return;
    const m = s.match(/\b[a-f0-9]{32}\b/i);
    if (m && RAW_FILE_ID_RE.test(m[0])) ids.add(m[0].toLowerCase());
  }

  const attrNames = [
    "data-file-id",
    "data-file_id",
    "data-fileid",
    "data-fileId",
  ];
  const selectors = [
    "[data-file-id]",
    "[data-file_id]",
    "[data-fileid]",
    "[data-fileId]",
  ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((el) => {
      for (const a of attrNames) {
        addHex32(el.getAttribute(a));
      }
    });
  }

  document
    .querySelectorAll('a[href*="/file/"], [href*="/file/"]')
    .forEach((el) => {
      addHex32(el.getAttribute("href"));
    });

  return [...ids];
}
