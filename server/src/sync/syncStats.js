import { ERROR_KIND_PLAUD_CHANGED } from "../errors/errorClassifier.js";

export function markPlaudChangedIfNeeded(stats, reported) {
  if (reported.classified.kind === ERROR_KIND_PLAUD_CHANGED) {
    stats.plaudChanged = true;
    stats.needsManualReview = true;
  }
}

export function emptyStats() {
  return {
    status: "running",
    runId: "",
    total: 0,
    processed: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    metadataUpdated: 0,
    skipped: 0,
    alreadySynced: 0,
    errors: 0,
    audioDownloaded: 0,
    summariesDownloaded: 0,
    plaudChanged: false,
    needsManualReview: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    dryRun: false,
  };
}
