import {
  buildStableId,
  buildSummaryBundle,
} from "../../../browser-extension/common/syncCore.js";
import { getRecordingCreatedAtRaw } from "../plaud/recordingTimestamps.js";
import { resolveMeetingTitle } from "./filenamePlanner.js";

/**
 * Stable identity for sync runner / syncCandidate (normalized title + summary bundle).
 *
 * @param {Record<string, any>} file
 * @param {{ summaries?: Array<{ markdown?: string }>; meetingTitle?: string }} [options]
 */
export function buildSyncStableIdentity(
  file,
  { summaries, meetingTitle } = {}
) {
  const summaryBundle =
    summaries !== undefined ? buildSummaryBundle(summaries) : undefined;
  const title =
    meetingTitle ??
    resolveMeetingTitle({
      plaudTitle: file.title,
      summaries,
      createdAt: getRecordingCreatedAtRaw(file.raw),
    });

  return buildStableId({
    ...file,
    raw: file.raw,
    title,
    ...(summaryBundle !== undefined ? { summaryMarkdown: summaryBundle } : {}),
    createdAt: getRecordingCreatedAtRaw(file.raw),
  });
}

/**
 * Stable identity for live tree browse (raw title, no summary — overlay merges sync-index).
 *
 * @param {Record<string, any>} file
 */
export function buildLiveTreeStableIdentity(file) {
  return buildStableId({
    ...file,
    raw: file.raw,
    title: String(file.title || "").trim(),
    createdAt: getRecordingCreatedAtRaw(file.raw),
  });
}

/**
 * Stable identity when persisting per-file sync errors (no summary fetch available).
 *
 * @param {Record<string, any>} file
 */
export function buildErrorRecordStableIdentity(file) {
  return buildStableId({
    ...file,
    raw: file.raw,
    title: String(file.title || file.id || "").trim(),
    createdAt: getRecordingCreatedAtRaw(file.raw),
  });
}
