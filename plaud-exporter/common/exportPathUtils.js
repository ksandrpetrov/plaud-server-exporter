/**
 * Pure helpers for download paths and export mode (shared: background + tests).
 */
export const DOWNLOAD_SUBDIRECTORY = "PlaudExports";
export const AUDIO_SUBDIRECTORY = `${DOWNLOAD_SUBDIRECTORY}/Audio`;
export const SUMMARY_SUBDIRECTORY = `${DOWNLOAD_SUBDIRECTORY}/Summaries`;
export const DEFAULT_SYNC_SUBDIRECTORY = `${DOWNLOAD_SUBDIRECTORY}/Sync`;

export const EXPORT_MODE_BOTH = "both";
export const EXPORT_MODE_AUDIO = "audio";
export const EXPORT_MODE_SUMMARY = "summary";

export const EXPORT_MODES = new Set([
  EXPORT_MODE_BOTH,
  EXPORT_MODE_AUDIO,
  EXPORT_MODE_SUMMARY,
]);

/**
 * @param {string} [mode]
 * @returns {"both"|"audio"|"summary"}
 */
export function normalizeExportMode(mode) {
  return EXPORT_MODES.has(mode) ? mode : EXPORT_MODE_BOTH;
}

const RESERVED_WINDOWS_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Cross-platform filename limits (conservative):
 * - Windows / macOS / Linux: 255 UTF-16 code units per path component (NAME_MAX).
 * - We target ~5% below 255 for the full filename including extension.
 */
export const MAX_PATH_COMPONENT_CHARS = 255;
export const MAX_FILENAME_WITH_EXTENSION = Math.floor(MAX_PATH_COMPONENT_CHARS * 0.95);
export const MARKDOWN_EXTENSION = ".md";
export const UTF8_BOM = "\uFEFF";

/**
 * Prepends a UTF-8 BOM when missing. iOS Files / Quick Look often mis-detect
 * BOM-less UTF-8 Cyrillic text as Windows-1251 and show mojibake.
 */
export function withUtf8Bom(text) {
  const value = String(text ?? "");
  if (value.length > 0 && value.charCodeAt(0) === 0xfeff) return value;
  return `${UTF8_BOM}${value}`;
}

export const DEFAULT_DATE_PREFIX_LENGTH = 13; // "YYYY-MM-DD - "
export const DEFAULT_FILENAME_MAX_LENGTH = Math.max(
  80,
  MAX_FILENAME_WITH_EXTENSION -
    MARKDOWN_EXTENSION.length -
    DEFAULT_DATE_PREFIX_LENGTH
);

const BOILERPLATE_TITLES = new Set([
  "plaud web",
  "plaud",
  "plaud note",
  "untitled",
  "summary",
  "recording",
]);

function toCleanString(value) {
  return String(value ?? "")
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\u00a0/g, " ");
}

/**
 * Removes common markdown syntax from a heading while preserving readable text.
 *
 * @param {string} value
 * @returns {string}
 */
export function stripMarkdownTitleMarkup(value) {
  return toCleanString(value)
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Headings that only brand the export — skip so the real topic title is used. */
const BOILERPLATE_MARKDOWN_HEADINGS = BOILERPLATE_TITLES;

/**
 * @param {string} strippedTitle from stripMarkdownTitleMarkup
 * @returns {boolean}
 */
function isBoilerplateMarkdownHeading(strippedTitle) {
  const key = String(strippedTitle || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  return BOILERPLATE_MARKDOWN_HEADINGS.has(key);
}

/**
 * @param {string} title
 * @returns {boolean}
 */
export function isBoilerplateTitle(title) {
  const key = String(title || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (!key) return true;
  return BOILERPLATE_TITLES.has(key);
}

/**
 * Truncates text on grapheme boundaries when Intl.Segmenter is available.
 *
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateToGraphemes(value, maxLength) {
  const text = String(value || "");
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  const segmenter =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  if (!segmenter) {
    return [...text].slice(0, maxLength).join("");
  }
  let count = 0;
  let out = "";
  for (const part of segmenter.segment(text)) {
    const piece = part.segment;
    if (count + piece.length > maxLength) break;
    out += piece;
    count += piece.length;
  }
  return out;
}

/**
 * Extracts the main title from the header: the first markdown heading that is
 * not a known boilerplate line (e.g. "Plaud Web" above the real H1). Falls back
 * to the first non-empty body line if there are no usable headings.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function extractTitleFromMarkdown(markdown) {
  const text = String(markdown || "").replace(/^\ufeff/, "");
  const lines = text.split(/\r?\n/);
  const headingLines = lines.filter((line) =>
    /^\s{0,3}#{1,6}\s+\S/.test(line)
  );
  for (const heading of headingLines) {
    const stripped = stripMarkdownTitleMarkup(heading);
    if (stripped && !isBoilerplateMarkdownHeading(stripped)) {
      return stripped;
    }
  }
  if (headingLines.length > 0) {
    return "";
  }
  const firstTextLine = lines.find((line) => stripMarkdownTitleMarkup(line));
  return firstTextLine ? stripMarkdownTitleMarkup(firstTextLine) : "";
}

function trimUnsafeFilenameEdges(value) {
  return value.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
}

/**
 * Sanitizes one filesystem path segment for macOS, Windows and Linux.
 * Problematic characters are turned into a readable dash separator rather than
 * dropped, which keeps names understandable: "A: B / C?" -> "A - B - C".
 *
 * @param {string} segment
 * @param {{ fallback?: string; maxLength?: number }} [options]
 * @returns {string}
 */
export function sanitizePathSegment(segment, options = {}) {
  const fallback = options.fallback || "Plaud export";
  const maxLength =
    Number.isFinite(Number(options.maxLength)) && Number(options.maxLength) > 0
      ? Number(options.maxLength)
      : DEFAULT_FILENAME_MAX_LENGTH;

  let safeValue = stripMarkdownTitleMarkup(
    toCleanString(segment).replace(/[<>]+/g, " - ")
  )
    .replace(/[\\/:*?"<>|]+/g, " - ")
    .replace(/[\u0028\u0029\u007b\u007d\u005b\u005d]+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/(?:\s+-\s+){2,}/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-+|-+$/g, "")
    .trim();

  safeValue = trimUnsafeFilenameEdges(safeValue);

  if (!safeValue) {
    safeValue = stripMarkdownTitleMarkup(fallback)
      .replace(/[\\/:*?"<>|]+/g, " - ")
      .replace(/\s+/g, " ")
      .trim();
  }

  safeValue = trimUnsafeFilenameEdges(safeValue) || "Plaud export";

  const baseForReservedCheck = safeValue.split(".")[0].toUpperCase();
  if (RESERVED_WINDOWS_NAMES.has(baseForReservedCheck)) {
    safeValue = `${safeValue}_`;
  }

  if (safeValue.length > maxLength) {
    safeValue = trimUnsafeFilenameEdges(safeValue.slice(0, maxLength));
  }

  return safeValue || "Plaud export";
}

export function sanitizeDownloadSegment(segment) {
  return sanitizePathSegment(segment, {
    fallback: "Plaud export",
    maxLength: DEFAULT_FILENAME_MAX_LENGTH,
  });
}

/**
 * Builds a safe filename with an extension. The extension is counted outside
 * maxLength so callers can keep the readable title portion bounded.
 *
 * @param {string} title
 * @param {{ extension?: string; fallbackBase?: string; maxBaseLength?: number }} [options]
 * @returns {string}
 */
export function normalizeFilename(title, options = {}) {
  const extensionRaw = String(options.extension || "").trim();
  const extension =
    extensionRaw && !extensionRaw.startsWith(".")
      ? `.${extensionRaw}`
      : extensionRaw;
  const fallbackBase = options.fallbackBase || "Plaud export";
  const maxBaseLength =
    Number.isFinite(Number(options.maxBaseLength)) &&
    Number(options.maxBaseLength) > 0
      ? Number(options.maxBaseLength)
      : DEFAULT_FILENAME_MAX_LENGTH;

  let base = sanitizePathSegment(title, {
    fallback: fallbackBase,
    maxLength: maxBaseLength,
  });

  if (extension && base.toLowerCase().endsWith(extension.toLowerCase())) {
    base = base.slice(0, -extension.length);
    base = trimUnsafeFilenameEdges(base) || sanitizePathSegment(fallbackBase);
  }

  return `${base}${extension}`;
}

/**
 * @param {string} [filename]
 * @returns {string}
 */
export function sanitizeDownloadFilename(filename) {
  const safeParts = String(filename || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(sanitizeDownloadSegment)
    .filter(Boolean);

  if (safeParts.length === 0) {
    return `${AUDIO_SUBDIRECTORY}/plaud-audio.audio.mp3`;
  }

  return safeParts.join("/");
}
