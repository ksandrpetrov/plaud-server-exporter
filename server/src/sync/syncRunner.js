import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { redactError } from "../security/redact.js";
import { reportError } from "../errors/errorReporter.js";
import { ERROR_KIND_PLAUD_CHANGED } from "../errors/errorClassifier.js";
import { PlaudAuthError, PlaudChangedError } from "../plaud/plaudApiClient.js";
import {
  buildStableId,
  detectDuplicate,
  determineSyncAction,
  hashStringSync,
  hashSummary,
  SYNC_ACTION_ALREADY_SYNCED,
  SYNC_ACTION_NEW,
  SYNC_ACTION_SKIPPED,
  SYNC_ACTION_UPDATED,
  SYNC_STATUS_ERROR,
  SYNC_STATUS_SKIPPED,
  SYNC_STATUS_SUCCESS,
  SYNC_STATUS_UPDATED,
  updateExistingRecord,
} from "../../../plaud-exporter/common/syncCore.js";
import { recordingsService } from "../plaud/recordingsService.js";
import { loadSyncIndex, saveSyncIndex } from "./serverSyncIndex.js";
import {
  buildMarkdownDocument,
  resolveMeetingTitle,
} from "./obsidianWriter.js";
import {
  collectOccupiedFilenames,
  planSummaryPath,
} from "./filenamePlanner.js";
import { acquireSyncLock, SyncLockError } from "./runLock.js";

export { SyncLockError };

function getRawField(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    const value = raw[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function buildAudioSignature(file) {
  const raw = file?.raw || {};
  const payload = {
    id: file?.id || "",
    size: getRawField(raw, ["size", "file_size", "fileSize", "audio_size", "audioSize", "bytes"]),
    duration: getRawField(raw, ["duration", "duration_ms", "durationMs", "audio_duration", "audioDuration"]),
    createdAt: getRawField(raw, ["created_at", "createdAt", "create_time", "createTime", "start_time", "startTime"]),
    updatedAt: getRawField(raw, ["updated_at", "updatedAt", "update_time", "updateTime", "modified_at", "modifiedAt"]),
    checksum: getRawField(raw, ["md5", "sha256", "checksum", "etag"]),
  };
  return `audio-meta:${hashStringSync(JSON.stringify(payload))}`;
}

async function summaryFileExists(absolutePath) {
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
async function needsSummaryRestore(existingRecord, plannedAbsolutePath) {
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

/**
 * @param {object | null | undefined} existingRecord
 * @param {string} plannedAbsolutePath
 */
function summaryPathsDiffer(existingRecord, plannedAbsolutePath) {
  const existing = String(existingRecord?.summaryPath || "");
  const planned = String(plannedAbsolutePath || "");
  return Boolean(existing && planned && existing !== planned);
}

function buildSummaryBundle(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) return "";
  return summaries
    .map((s) => String(s?.markdown || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

async function buildCandidate(file, summaries) {
  const summaryBundle = buildSummaryBundle(summaries);
  const meetingTitle = resolveMeetingTitle({
    plaudTitle: file.title,
    summaries,
    createdAt: getRawField(file.raw, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "start_time",
      "startTime",
    ]),
  });

  const identity = buildStableId({
    ...file,
    raw: file.raw,
    title: meetingTitle,
    summaryMarkdown: summaryBundle,
    createdAt: getRawField(file.raw, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "start_time",
      "startTime",
    ]),
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
    createdAt: getRawField(file.raw, ["created_at", "createdAt", "create_time", "createTime", "start_time", "startTime"]),
    updatedAt: getRawField(file.raw, ["updated_at", "updatedAt", "update_time", "updateTime", "modified_at", "modifiedAt"]),
    normalizedFilename: "",
    folderSegment: String(file.folderSegment || "").trim(),
  };
}

function emptyStats() {
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

/**
 * @param {{
 *   session: import("../auth/plaudSessionExtractor.js").PlaudSession;
 *   dryRun?: boolean;
 *   onProgress?: (stats: object) => void;
 * }} args
 */
export async function runSync(args) {
  const { session, onProgress } = args;
  const dryRun = !!args.dryRun;
  const runId = randomUUID();

  const stats = emptyStats();
  stats.runId = runId;
  stats.dryRun = dryRun;

  // Dry-run does not write anything mutable, so it does not need the lock.
  const release = dryRun ? async () => {} : await acquireSyncLock();
  try {
    return await runSyncCore({ session, onProgress, dryRun, runId, stats });
  } finally {
    try {
      await release();
    } catch {
      // Releasing is best-effort.
    }
  }
}

async function runSyncCore({ session, onProgress, dryRun, runId, stats }) {
  const syncIndex = await loadSyncIndex();
  let files;

  try {
    files = await recordingsService.list(session);
  } catch (error) {
    stats.errors++;
    stats.status = "failed";
    stats.finishedAt = new Date().toISOString();
    const reported = await reportError(error, {
      stage: "list-recordings",
      runId,
      endpoint: "/file/simple/web",
      dryRun,
    });
    if (reported.classified.kind === ERROR_KIND_PLAUD_CHANGED) {
      stats.plaudChanged = true;
      stats.needsManualReview = true;
    }
    await writeStatusFile({ stats, lastAuthError: error instanceof PlaudAuthError ? error.message : null });
    const err = error instanceof Error ? error : new Error(String(error));
    err.exitCode = reported.classified.exitCode;
    throw err;
  }

  stats.total = files.length;
  logger.info("Discovered Plaud recordings.", { count: files.length, dryRun });

  for (const file of files) {
    try {
      let summaries = [];
      try {
        summaries = await recordingsService.summaries(session, file);
      } catch (summaryError) {
        stats.errors++;
        logger.warn(`Summary read failed for ${file.id}.`, redactError(summaryError));
        await reportError(summaryError, {
          stage: "fetch-summary",
          runId,
          endpoint: "/ai/query_note",
          dryRun,
        });
        if (summaryError instanceof PlaudChangedError) {
          stats.plaudChanged = true;
          stats.needsManualReview = true;
        }
        stats.processed++;
        continue;
      }

      const candidate = await buildCandidate(file, summaries);
      const occupied = collectOccupiedFilenames(syncIndex, candidate.stableId);
      const planned = planSummaryPath({
        title: candidate.title,
        createdAt: candidate.createdAt,
        occupiedFilenames: occupied,
        stableId: candidate.stableId,
        folderSegment: file.folderSegment || "",
      });
      candidate.normalizedFilename = planned.normalizedFilename;

      const duplicate = detectDuplicate(syncIndex, candidate);
      const existingRecord = duplicate?.record || null;
      let action = determineSyncAction(existingRecord, candidate);

      if (
        action.action === SYNC_ACTION_ALREADY_SYNCED &&
        existingRecord &&
        (await needsSummaryRestore(existingRecord, planned.absolutePath))
      ) {
        action = {
          action: SYNC_ACTION_UPDATED,
          status: SYNC_STATUS_UPDATED,
          downloadRequired: true,
          metadataOnly: false,
          reason: "summary_file_missing",
        };
      }

      if (
        action.action === SYNC_ACTION_ALREADY_SYNCED &&
        existingRecord &&
        summaryPathsDiffer(existingRecord, planned.absolutePath)
      ) {
        action = {
          action: SYNC_ACTION_UPDATED,
          status: SYNC_STATUS_UPDATED,
          downloadRequired: false,
          metadataOnly: true,
          reason: "path_changed",
        };
      }

      if (action.action === SYNC_ACTION_SKIPPED) {
        stats.skipped++;
        stats.processed++;
        if (!dryRun && candidate.stableId) {
          syncIndex.records[candidate.stableId] = updateExistingRecord(
            existingRecord,
            candidate,
            { status: SYNC_STATUS_SKIPPED }
          );
        }
        onProgress?.({ ...stats, lastMessage: `Skipped: ${candidate.title}` });
        continue;
      }

      if (action.action === SYNC_ACTION_ALREADY_SYNCED) {
        stats.alreadySynced++;
        stats.unchanged++;
        stats.processed++;
        if (!dryRun) {
          syncIndex.records[candidate.stableId] = updateExistingRecord(
            existingRecord,
            candidate,
            { status: SYNC_STATUS_SUCCESS, summaryPath: planned.absolutePath }
          );
        }
        onProgress?.({ ...stats, lastMessage: `Unchanged: ${candidate.title}` });
        continue;
      }

      const previousAbsolutePath = existingRecord?.summaryPath || "";

      if (action.metadataOnly) {
        stats.metadataUpdated++;
        stats.processed++;
        if (!dryRun) {
          const document = buildMarkdownDocument({ file, summaries, candidate });
          await writeMarkdownFile({
            absolutePath: planned.absolutePath,
            contents: document,
            previousAbsolutePath,
          });
          syncIndex.records[candidate.stableId] = updateExistingRecord(
            existingRecord,
            candidate,
            {
              status: SYNC_STATUS_UPDATED,
              summaryPath: planned.absolutePath,
              audioPath: existingRecord?.audioPath || "",
            }
          );
        }
        onProgress?.({
          ...stats,
          lastMessage: dryRun
            ? `Would rename: ${candidate.title}`
            : `Renamed: ${candidate.title}`,
        });
        continue;
      }

      const audioPath = existingRecord?.audioPath || "";

      if (!dryRun) {
        const document = buildMarkdownDocument({ file, summaries, candidate });
        await writeMarkdownFile({
          absolutePath: planned.absolutePath,
          contents: document,
          previousAbsolutePath,
        });
        stats.summariesDownloaded++;
      }

      if (action.action === SYNC_ACTION_NEW) stats.new++;
      else if (action.action === SYNC_ACTION_UPDATED) stats.updated++;
      stats.processed++;

      if (!dryRun) {
        syncIndex.records[candidate.stableId] = updateExistingRecord(
          existingRecord,
          candidate,
          {
            status:
              action.action === SYNC_ACTION_UPDATED
                ? SYNC_STATUS_UPDATED
                : SYNC_STATUS_SUCCESS,
            summaryPath: planned.absolutePath,
            audioPath,
          }
        );
      }

      const verb = dryRun
        ? action.action === SYNC_ACTION_NEW
          ? "Would create"
          : "Would update"
        : "Synced";
      onProgress?.({ ...stats, lastMessage: `${verb}: ${candidate.title}` });
    } catch (error) {
      stats.errors++;
      stats.processed++;
      logger.errorFrom(`Sync failed for ${file.id}.`, error);
      const reported = await reportError(error, {
        stage: "write-file",
        runId,
        dryRun,
      });
      if (reported.classified.kind === ERROR_KIND_PLAUD_CHANGED) {
        stats.plaudChanged = true;
        stats.needsManualReview = true;
      }
      if (!dryRun) {
        const identity = buildStableId(file);
        if (identity.stableId) {
          syncIndex.records[identity.stableId] = {
            ...(syncIndex.records[identity.stableId] || {}),
            stableId: identity.stableId,
            title: file.title || file.id,
            status: SYNC_STATUS_ERROR,
            lastError: String(error?.message || error || "unknown"),
            lastSyncedAt: new Date().toISOString(),
          };
        }
      }
    }
  }

  if (!dryRun) await saveSyncIndex(syncIndex);

  stats.status = stats.plaudChanged ? "plaud_changed" : stats.errors > 0 ? "completed_with_errors" : "completed";
  stats.finishedAt = new Date().toISOString();

  await writeStatusFile({ stats });

  if (stats.plaudChanged) {
    const err = new PlaudChangedError(
      "Sync detected Plaud API or response-shape changes; see _errors/ and logs."
    );
    err.exitCode = 3;
    throw err;
  }

  if (stats.errors > 0) {
    const err = new Error(`Sync finished with ${stats.errors} error(s).`);
    err.exitCode = 1;
    throw err;
  }

  return stats;
}

async function writeMarkdownFile(args) {
  const { writeMarkdownFile: writeMd } = await import("./obsidianWriter.js");
  return writeMd(args);
}

async function writeStatusFile({ stats, lastAuthError } = {}) {
  const payload = {
    lastSyncAt: stats?.finishedAt || null,
    lastSyncStats: stats || null,
    lastAuthError: lastAuthError || null,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(config.statusPath), { recursive: true });
  const tmp = `${config.statusPath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, config.statusPath);
}

export async function recordAuthError(message) {
  let existing = {};
  try {
    const { readFile } = await import("node:fs/promises");
    existing = JSON.parse(await readFile(config.statusPath, "utf8"));
  } catch {
    existing = {};
  }
  const payload = {
    ...existing,
    lastAuthError: { message: String(message || "").slice(0, 500), at: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(config.statusPath), { recursive: true });
  await writeFile(config.statusPath, JSON.stringify(payload, null, 2), "utf8");
}
