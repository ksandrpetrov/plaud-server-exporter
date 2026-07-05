/**
 * features/audioExport/extensionSmartSync.js
 * Smart background sync via Plaud API + chrome.downloads subfolder.
 */
import {
  DEFAULT_SYNC_SUBDIRECTORY,
  extractTitleFromMarkdown,
  normalizeFilename,
} from "../../common/exportPathUtils.js";
import { normalizeHumanTitle } from "../../common/plaudTitles.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import { loadSyncIndex, saveSyncIndex } from "../../common/storageUtils.js";
import {
  buildAudioSignature,
  buildStableId,
  buildSummaryBundle,
  detectDuplicate,
  determineSyncAction,
  getRawField,
  hashSummary,
  RECORDING_CREATED_AT_KEYS,
  RECORDING_UPDATED_AT_KEYS,
  refineSyncActionForDisk,
  sanitizeSyncSubdirectory,
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
import { fetchPlaudFilesFromApi, preferApiTitle } from "./plaudBrowserApi.js";
import { getPlaudSession } from "./plaudBrowserSession.js";
import {
  basenameFromDownloadPath,
  buildCollisionSafePath,
  buildDownloadFilename,
  getExtensionFromUrl,
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
import {
  mergeDomRecordingIdsIntoFiles,
  mergeLocalStorageRecordingIdsIntoFiles,
} from "./plaudRecordingIdScraper.js";

function getCurrentPlaudSourceUrl() {
  if (typeof window === "undefined" || !window.location) return "";
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return window.location.href || "";
  }
}

async function buildSyncCandidate(file, summaryExports, sourceUrl) {
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

function makeSyncStats() {
  return {
    status: "running",
    total: 0,
    processed: 0,
    new: 0,
    updated: 0,
    skipped: 0,
    alreadySynced: 0,
    errors: 0,
    audioDownloaded: 0,
    summariesDownloaded: 0,
    startedAt: Date.now(),
    finishedAt: null,
    currentTitle: "",
    lastMessage: "",
  };
}

/**
 * Smart background sync: uses Plaud API through the content-script context
 * (where Plaud session tokens are available), but persists a stable index in
 * chrome.storage.local and downloads through chrome.downloads. Chrome
 * extensions cannot reliably pick an arbitrary native folder from a service
 * worker; sync therefore targets a user-configurable subfolder inside the
 * browser Downloads directory.
 *
 * @param {{ syncSubdirectory?: string; onProgress?: (stats: object) => void }} [options]
 * @returns {Promise<object>}
 */
export async function runSmartSync(options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const requestedSubdir = sanitizeSyncSubdirectory(
    options.syncSubdirectory || DEFAULT_SYNC_SUBDIRECTORY
  );
  const syncMode = options.syncMode === "summary" ? "summary" : "both";
  const shouldDownloadAudio = syncMode !== "summary";
  const stats = makeSyncStats();
  const sourceUrl = getCurrentPlaudSourceUrl();
  let syncIndex = await loadSyncIndex();
  syncIndex.settings = {
    ...syncIndex.settings,
    storageMode: "downloads_subfolder",
    syncSubdirectory: requestedSubdir,
    syncMode,
  };
  await saveSyncIndex(syncIndex);

  function progress(patch = {}) {
    Object.assign(stats, patch);
    onProgress?.({ ...stats });
  }

  const session = await getPlaudSession();
  let files = await fetchPlaudFilesFromApi(session);
  mergeDomRecordingIdsIntoFiles(files, { unfiledLabel: PLAUD_FOLDER_UNFILED });
  mergeLocalStorageRecordingIdsIntoFiles(files);
  stats.total = files.length;
  progress({ lastMessage: `Найдено записей: ${files.length}` });

  for (const file of files) {
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
            {
              status: SYNC_STATUS_SKIPPED,
            }
          );
          await saveSyncIndex(syncIndex);
        }
        progress({ lastMessage: `Пропущено: ${workingFile.title}` });
        continue;
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
        continue;
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
        continue;
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

  stats.status = "completed";
  stats.finishedAt = Date.now();
  stats.lastMessage = `Готово: ${stats.new} новых, ${stats.updated} обновлено, ${stats.skipped} пропущено.`;
  progress();
  return stats;
}
