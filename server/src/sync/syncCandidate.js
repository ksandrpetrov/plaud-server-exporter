import { stat } from "node:fs/promises";
import { config } from "../config/config.js";
import {
  buildAudioSignature,
  buildStableId,
  buildSummaryBundle,
  hashSummary,
} from "../../../browser-extension/common/syncCore.js";
import { PLAUD_FOLDER_UNFILED } from "../plaud/plaudFolders.js";
import {
  getRecordingCreatedAtRaw,
  getRecordingUpdatedAtRaw,
} from "../plaud/recordingTimestamps.js";
import { resolveMeetingTitle } from "./filenamePlanner.js";

export async function summaryFileExists(absolutePath) {
  if (!absolutePath) return false;
  try {
    const info = await stat(absolutePath);
    return info.isFile();
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * True when the index says synced but no summary file exists on disk
 * (user deleted it manually, or a partial write left only the index).
 */
export async function needsSummaryRestore(existingRecord, plannedAbsolutePath) {
  if (!existingRecord?.summaryHash) return false;
  const paths = new Set(
    [plannedAbsolutePath, existingRecord.summaryPath].filter(Boolean)
  );
  if (!paths.size) return true;
  for (const path of paths) {
    if (await summaryFileExists(path)) return false;
  }
  return true;
}

export function resolveSyncFolderSegment(file) {
  const segment = String(file?.folderSegment || "").trim();
  if (!config.mirrorFolders) return "";
  return segment || PLAUD_FOLDER_UNFILED;
}

export async function buildCandidate(file, summaries) {
  const summaryBundle = buildSummaryBundle(summaries);
  const meetingTitle = resolveMeetingTitle({
    plaudTitle: file.title,
    summaries,
    createdAt: getRecordingCreatedAtRaw(file.raw),
  });

  const identity = buildStableId({
    ...file,
    raw: file.raw,
    title: meetingTitle,
    summaryMarkdown: summaryBundle,
    createdAt: getRecordingCreatedAtRaw(file.raw),
  });

  return {
    stableId: identity.stableId,
    identityKind: identity.identityKind,
    identityConfidence: identity.confidence,
    fingerprint: identity.fingerprint,
    title: meetingTitle,
    sourceUrl: "",
    summaryHash: await hashSummary(summaryBundle),
    audioSignature: buildAudioSignature(file),
    createdAt: getRecordingCreatedAtRaw(file.raw),
    updatedAt: getRecordingUpdatedAtRaw(file.raw),
    normalizedFilename: "",
    folderSegment: resolveSyncFolderSegment(file),
  };
}
