/**
 * Pure helpers for planning Chrome `chrome.downloads` filenames inside
 * the smart-sync subdirectory.
 *
 * Responsibilities:
 *   - Sanitize titles into safe filename parts
 *   - Build per-folder relative paths (Audio / Summary)
 *   - Resolve collisions against both the local sync index and other files
 *     planned in the same run
 *
 * No I/O; safe to unit-test without Chrome APIs.
 */

import {
  AUDIO_SUBDIRECTORY,
  SUMMARY_SUBDIRECTORY,
  extractTitleFromMarkdown,
  normalizeFilename,
  sanitizePathSegment,
} from "../../common/exportPathUtils.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import { buildRelativeArtifactPath } from "../../common/syncCore.js";

/** Long titles often blow past the 255-char filename budget. */
export function sanitizeFilenamePart(value, fallback = "plaud-audio") {
  return sanitizePathSegment(value, { fallback, maxLength: 140 });
}

/**
 * Guess the audio extension from a Plaud download URL (mp3 by default).
 *
 * @param {string} url
 */
export function getExtensionFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // Fall back to MP3 below.
  }
  return "mp3";
}

/**
 * Compose `<base>/<folder>/<filename>` with safe folder sanitization.
 *
 * @param {string} baseSubdirectory
 * @param {string} folderSegment
 * @param {string} leafFilename
 */
export function exportPathWithFolder(
  baseSubdirectory,
  folderSegment,
  leafFilename
) {
  const folder = sanitizePathSegment(folderSegment || PLAUD_FOLDER_UNFILED, {
    fallback: PLAUD_FOLDER_UNFILED,
    maxLength: 80,
  });
  return `${baseSubdirectory}/${folder}/${leafFilename}`;
}

/**
 * Builds the relative `chrome.downloads` filename for audio export, including
 * folder segment. Used by `runExportAll` (writes under `AUDIO_SUBDIRECTORY`).
 */
export function buildDownloadFilename(file, url) {
  const rawBase = sanitizeFilenamePart(file.title);
  const ext = getExtensionFromUrl(url);
  let core = rawBase;
  if (/\.[a-z0-9]{2,5}$/i.test(core)) {
    core = core.replace(/\.[a-z0-9]{2,5}$/i, "");
  }
  const filename = normalizeFilename(`${core}.audio`, {
    extension: ext,
    fallbackBase: "plaud-audio",
    maxBaseLength: 132,
  });
  return exportPathWithFolder(
    AUDIO_SUBDIRECTORY,
    file?.folderSegment,
    filename
  );
}

/**
 * Resolve a summary filename: prefer the first markdown heading, then the
 * Plaud-provided title, then a generic fallback. Adds a `${index+1}` suffix
 * for multiple summaries per recording.
 *
 * @param {string} markdown
 * @param {string} fallbackTitle
 * @param {number} [index]
 * @param {{ folderSegment?: string } | null} [file]
 * @param {(value: string) => string} normalizeTitle
 *   Injection point for `normalizeHumanTitle` (kept private to the API
 *   module so this helper stays Plaud-API-agnostic).
 */
export function buildSummaryFilename(
  markdown,
  fallbackTitle,
  index = 0,
  file = null,
  normalizeTitle = (s) => s
) {
  const title =
    extractTitleFromMarkdown(markdown) ||
    normalizeTitle(fallbackTitle) ||
    "Plaud summary";
  const suffix = index > 0 ? ` ${index + 1}` : "";
  const filename = normalizeFilename(`${title}${suffix}`, {
    extension: ".md",
    fallbackBase: "Plaud summary",
    maxBaseLength: 132,
  });
  return exportPathWithFolder(
    SUMMARY_SUBDIRECTORY,
    file?.folderSegment,
    filename
  );
}

export function basenameFromDownloadPath(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Add a short stable-id suffix before the file extension, e.g.
 * `Notes - abc12345.md`.
 */
export function appendStableSuffixToFilename(filename, stableId) {
  const safeSuffix = sanitizePathSegment(
    String(stableId || "")
      .replace(/^plaud:/, "")
      .replace(/^fingerprint:/, "")
      .slice(0, 8),
    { fallback: "record", maxLength: 16 }
  );
  const safeName = basenameFromDownloadPath(filename);
  const dot = safeName.lastIndexOf(".");
  if (dot <= 0) return `${safeName} - ${safeSuffix}`;
  return `${safeName.slice(0, dot)} - ${safeSuffix}${safeName.slice(dot)}`;
}

/**
 * Reserves a download path within the in-flight `usedPaths` set, falling
 * back to suffixed variants to avoid collisions inside one run.
 */
export function reservePlannedDownloadPath(path, stableId, usedPaths) {
  if (!usedPaths?.has(path)) {
    usedPaths?.add(path);
    return path;
  }
  const parts = String(path || "").split("/");
  const filename = parts.pop() || "Plaud export";
  const directory = parts.join("/");
  let candidate = `${directory}/${appendStableSuffixToFilename(filename, stableId)}`;
  let counter = 2;
  while (usedPaths.has(candidate)) {
    candidate = `${directory}/${appendStableSuffixToFilename(
      filename,
      `${stableId}-${counter}`
    )}`;
    counter++;
  }
  usedPaths.add(candidate);
  return candidate;
}

/** True when another sync-index record already claims this disk path. */
export function isPathOwnedByOtherRecord(syncIndex, path, stableId) {
  const wantedPath = String(path || "");
  if (!wantedPath) return false;
  for (const [recordId, record] of Object.entries(syncIndex.records || {})) {
    if (recordId === stableId) continue;
    const paths = [
      record?.audioPath,
      record?.summaryPath,
      ...(Array.isArray(record?.summaryPaths) ? record.summaryPaths : []),
    ].filter(Boolean);
    if (paths.includes(wantedPath)) return true;
  }
  return false;
}

/**
 * Primary entry point used by `runSmartSync`: derive a relative artifact path
 * that doesn't collide with any other record in the sync index.
 */
export function buildCollisionSafePath(
  syncIndex,
  subdirectory,
  artifactType,
  filename,
  stableId,
  folderSegment = ""
) {
  let path = buildRelativeArtifactPath(
    subdirectory,
    artifactType,
    filename,
    folderSegment
  );
  if (!isPathOwnedByOtherRecord(syncIndex, path, stableId)) return path;
  path = buildRelativeArtifactPath(
    subdirectory,
    artifactType,
    appendStableSuffixToFilename(filename, stableId),
    folderSegment
  );
  return path;
}
