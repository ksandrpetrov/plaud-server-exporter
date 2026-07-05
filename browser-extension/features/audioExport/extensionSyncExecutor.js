import { saveSyncIndex } from "../../common/storageUtils.js";
import {
  buildStableId,
  detectDuplicate,
  determineSyncAction,
  refineSyncActionForDisk,
  SYNC_ACTION_ALREADY_SYNCED,
  SYNC_ACTION_NEW,
  SYNC_ACTION_SKIPPED,
  SYNC_ACTION_UPDATED,
  SYNC_STATUS_ERROR,
  SYNC_STATUS_SKIPPED,
  SYNC_STATUS_SUCCESS,
  SYNC_STATUS_UPDATED,
  updateExistingRecord,
} from "../../common/syncCore.js";
import { preferApiTitle } from "../../common/plaudTitles.js";
import {
  basenameFromDownloadPath,
  buildCollisionSafePath,
  buildDownloadFilename,
} from "./plaudCollisionPaths.js";
import {
  buildSummaryFilenameForFile,
  downloadTextViaBackground,
  downloadViaBackground,
} from "./extensionDownloadBridge.js";
import {
  fetchPlaudAudioUrl,
  fetchPlaudSummaryExports,
} from "./plaudMediaFetch.js";
import { buildSyncCandidate } from "./extensionSyncCandidate.js";

/**
 * Process one file in the smart sync loop (mutates syncIndex + stats).
 *
 * @param {{
 *   session: object;
 *   file: object;
 *   syncIndex: object;
 *   stats: object;
 *   progress: (patch?: object) => void;
 *   requestedSubdir: string;
 *   shouldDownloadAudio: boolean;
 *   sourceUrl: string;
 * }} params
 */
export async function processSmartSyncFile({
  session,
  file,
  syncIndex,
  stats,
  progress,
  requestedSubdir,
  shouldDownloadAudio,
  sourceUrl,
}) {
  stats.currentTitle = file.title;
  progress();

  try {
    let workingFile = file;
    let summaryExports = [];
    try {
      summaryExports = await fetchPlaudSummaryExports(session, workingFile);
    } catch (summaryError) {
      console.warn(
        `Smart sync: summary read failed for "${workingFile.title}":`,
        summaryError
      );
      summaryExports = [];
    }

    const candidate = await buildSyncCandidate(
      workingFile,
      summaryExports,
      sourceUrl
    );
    const duplicate = detectDuplicate(syncIndex, candidate);
    const existingRecord = duplicate?.record || null;

    let plannedSummaryPath = "";
    if (summaryExports.length > 0) {
      const firstSummary = summaryExports[0];
      const baseSummaryPath = buildSummaryFilenameForFile(
        firstSummary.markdown,
        firstSummary.title || workingFile.title,
        0,
        workingFile
      );
      const summaryFilename = basenameFromDownloadPath(baseSummaryPath);
      plannedSummaryPath = buildCollisionSafePath(
        syncIndex,
        requestedSubdir,
        "summary",
        summaryFilename,
        candidate.stableId,
        candidate.folderSegment
      );
    }

    let action = determineSyncAction(existingRecord, candidate);
    action = refineSyncActionForDisk(action, existingRecord, {
      plannedSummaryPath,
      summaryMissingOnDisk: false,
    });

    if (action.action === SYNC_ACTION_SKIPPED) {
      stats.skipped++;
      stats.processed++;
      if (candidate.stableId) {
        syncIndex.records[candidate.stableId] = updateExistingRecord(
          existingRecord,
          candidate,
          { status: SYNC_STATUS_SKIPPED }
        );
        await saveSyncIndex(syncIndex);
      }
      progress({ lastMessage: `Пропущено: ${workingFile.title}` });
      return;
    }

    if (action.action === SYNC_ACTION_ALREADY_SYNCED) {
      stats.alreadySynced++;
      stats.skipped++;
      stats.processed++;
      syncIndex.records[candidate.stableId] = updateExistingRecord(
        existingRecord,
        candidate,
        { status: SYNC_STATUS_SUCCESS }
      );
      await saveSyncIndex(syncIndex);
      progress({ lastMessage: `Уже синхронизировано: ${workingFile.title}` });
      return;
    }

    const folderRelocate =
      action.metadataOnly &&
      String(existingRecord?.folderSegment || "").trim() !==
        String(candidate.folderSegment || "").trim();

    if (action.metadataOnly && !folderRelocate) {
      stats.updated++;
      stats.processed++;
      syncIndex.records[candidate.stableId] = updateExistingRecord(
        existingRecord,
        candidate,
        { status: SYNC_STATUS_UPDATED }
      );
      await saveSyncIndex(syncIndex);
      progress({ lastMessage: `Обновлены метаданные: ${workingFile.title}` });
      return;
    }

    const lastDownloadIds = [];
    let audioPath = folderRelocate ? "" : existingRecord?.audioPath || "";
    let summaryPath = folderRelocate ? "" : existingRecord?.summaryPath || "";
    let summaryPaths =
      folderRelocate || !Array.isArray(existingRecord?.summaryPaths)
        ? []
        : [...existingRecord.summaryPaths];

    try {
      if (shouldDownloadAudio) {
        const { url, titleHint } = await fetchPlaudAudioUrl(
          session,
          workingFile.id
        );
        workingFile = preferApiTitle(workingFile, titleHint);
        candidate.audioUrl = url;
        candidate.audioNormalizedFilename = basenameFromDownloadPath(
          buildDownloadFilename(workingFile, url)
        );
        if (!audioPath) {
          audioPath = buildCollisionSafePath(
            syncIndex,
            requestedSubdir,
            "audio",
            candidate.audioNormalizedFilename,
            candidate.stableId,
            candidate.folderSegment
          );
        }
        const audioResponse = await downloadViaBackground(url, audioPath, {
          conflictAction: "overwrite",
        });
        if (audioResponse?.downloadId) {
          lastDownloadIds.push(audioResponse.downloadId);
        }
        stats.audioDownloaded++;
      }
    } catch (audioError) {
      console.warn(
        `Smart sync: audio download failed for "${workingFile.title}":`,
        audioError
      );
      stats.errors++;
    }

    if (summaryExports.length > 0) {
      for (const [summaryIndex, summaryExport] of summaryExports.entries()) {
        const baseSummaryPath = buildSummaryFilenameForFile(
          summaryExport.markdown,
          summaryExport.title || workingFile.title,
          summaryIndex,
          workingFile
        );
        const summaryFilename = basenameFromDownloadPath(baseSummaryPath);
        const targetPath =
          (!folderRelocate && summaryPaths[summaryIndex]) ||
          buildCollisionSafePath(
            syncIndex,
            requestedSubdir,
            "summary",
            summaryFilename,
            candidate.stableId,
            candidate.folderSegment
          );

        const summaryResponse = await downloadTextViaBackground(
          summaryExport.markdown,
          targetPath,
          { conflictAction: "overwrite" }
        );
        if (summaryResponse?.downloadId) {
          lastDownloadIds.push(summaryResponse.downloadId);
        }
        summaryPaths[summaryIndex] = targetPath;
        if (!summaryPath) summaryPath = targetPath;
        stats.summariesDownloaded++;
      }
    }

    if (action.action === SYNC_ACTION_NEW) {
      stats.new++;
    } else if (action.action === SYNC_ACTION_UPDATED) {
      stats.updated++;
    }

    stats.processed++;
    syncIndex.records[candidate.stableId] = {
      ...updateExistingRecord(existingRecord, candidate, {
        status:
          action.action === SYNC_ACTION_UPDATED
            ? SYNC_STATUS_UPDATED
            : SYNC_STATUS_SUCCESS,
        audioPath,
        summaryPath,
        lastDownloadIds,
      }),
      summaryPaths,
    };
    await saveSyncIndex(syncIndex);
    progress({ lastMessage: `Синхронизировано: ${workingFile.title}` });
  } catch (error) {
    console.error(`Smart sync failed for "${file.title}":`, error);
    stats.errors++;
    stats.processed++;
    progress({ lastMessage: `Ошибка: ${file.title}` });
    if (file?.id) {
      const identity = buildStableId(file);
      if (identity.stableId) {
        syncIndex.records[identity.stableId] = {
          ...(syncIndex.records[identity.stableId] || {}),
          stableId: identity.stableId,
          title: file.title || file.id,
          status: SYNC_STATUS_ERROR,
          lastError: error?.message || String(error),
          lastSyncedAt: new Date().toISOString(),
        };
        await saveSyncIndex(syncIndex);
      }
    }
  }
}
