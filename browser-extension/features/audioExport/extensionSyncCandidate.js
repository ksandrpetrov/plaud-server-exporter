import {
  extractTitleFromMarkdown,
  normalizeFilename,
} from "../../common/exportPathUtils.js";
import { normalizeHumanTitle } from "../../common/plaudTitles.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import {
  buildAudioSignature,
  buildStableId,
  buildSummaryBundle,
  getRawField,
  hashSummary,
  RECORDING_CREATED_AT_KEYS,
  RECORDING_UPDATED_AT_KEYS,
} from "../../common/syncCore.js";
import { getExtensionFromUrl } from "./plaudCollisionPaths.js";

export function getCurrentPlaudSourceUrl() {
  if (typeof window === "undefined" || !window.location) return "";
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return window.location.href || "";
  }
}

/**
 * @param {PlaudRecording} file
 * @param {PlaudSummaryExport[]} summaryExports
 * @param {string} sourceUrl
 * @returns {Promise<SyncCandidate>}
 */
export async function buildSyncCandidate(file, summaryExports, sourceUrl) {
  const summaryBundle = buildSummaryBundle(summaryExports);
  const identity = buildStableId({
    ...file,
    raw: file.raw,
    title: file.title,
    sourceUrl,
    summaryMarkdown: summaryBundle,
    createdAt: getRawField(file.raw, RECORDING_CREATED_AT_KEYS),
  });
  const firstSummary = Array.isArray(summaryExports) ? summaryExports[0] : null;
  const summaryTitle =
    extractTitleFromMarkdown(firstSummary?.markdown || "") ||
    normalizeHumanTitle(file.title) ||
    "Plaud summary";
  const audioExt = getExtensionFromUrl("");
  return {
    stableId: identity.stableId,
    identityKind: identity.identityKind,
    identityConfidence: identity.confidence,
    fingerprint: identity.fingerprint,
    title: normalizeHumanTitle(file.title) || summaryTitle,
    sourceUrl,
    summaryHash: await hashSummary(summaryBundle),
    audioSignature: buildAudioSignature(file),
    normalizedFilename: normalizeFilename(summaryTitle, {
      extension: ".md",
      fallbackBase: "Plaud summary",
      maxBaseLength: 132,
    }),
    audioNormalizedFilename: normalizeFilename(
      `${normalizeHumanTitle(file.title) || "plaud-audio"}.audio`,
      {
        extension: audioExt,
        fallbackBase: "plaud-audio",
        maxBaseLength: 132,
      }
    ),
    createdAt: getRawField(file.raw, RECORDING_CREATED_AT_KEYS),
    updatedAt: getRawField(file.raw, RECORDING_UPDATED_AT_KEYS),
    folderSegment: String(file.folderSegment || PLAUD_FOLDER_UNFILED).trim(),
  };
}
