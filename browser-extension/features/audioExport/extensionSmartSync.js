/**
 * Smart background sync via Plaud API + chrome.downloads subfolder.
 */
import { DEFAULT_SYNC_SUBDIRECTORY } from "../../common/exportPathUtils.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import { loadSyncIndex, saveSyncIndex } from "../../common/storageUtils.js";
import { sanitizeSyncSubdirectory } from "../../common/syncCore.js";
import { fetchPlaudFilesFromApi } from "./plaudBrowserApi.js";
import { getPlaudSession } from "./plaudBrowserSession.js";
import {
  mergeDomRecordingIdsIntoFiles,
  mergeLocalStorageRecordingIdsIntoFiles,
} from "./plaudRecordingIdScraper.js";
import { getCurrentPlaudSourceUrl } from "./extensionSyncCandidate.js";
import { processSmartSyncFile } from "./extensionSyncExecutor.js";

export { buildSyncCandidate } from "./extensionSyncCandidate.js";

/** @returns {SmartSyncStats} */
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
 * @param {{
 *   syncSubdirectory?: string;
 *   onProgress?: (stats: SmartSyncStats) => void;
 *   syncMode?: PlaudSyncMode;
 *   _deps?: Partial<{
 *     loadSyncIndex: typeof loadSyncIndex;
 *     saveSyncIndex: typeof saveSyncIndex;
 *     getPlaudSession: typeof getPlaudSession;
 *     fetchPlaudFilesFromApi: typeof fetchPlaudFilesFromApi;
 *     mergeDomRecordingIdsIntoFiles: typeof mergeDomRecordingIdsIntoFiles;
 *     mergeLocalStorageRecordingIdsIntoFiles: typeof mergeLocalStorageRecordingIdsIntoFiles;
 *     getCurrentPlaudSourceUrl: typeof getCurrentPlaudSourceUrl;
 *     processSmartSyncFile: typeof processSmartSyncFile;
 *   }>;
 * }} [options]
 * @returns {Promise<SmartSyncStats>}
 */
export async function runSmartSync(options = {}) {
  const deps = {
    loadSyncIndex,
    saveSyncIndex,
    getPlaudSession,
    fetchPlaudFilesFromApi,
    mergeDomRecordingIdsIntoFiles,
    mergeLocalStorageRecordingIdsIntoFiles,
    getCurrentPlaudSourceUrl,
    processSmartSyncFile,
    ...options._deps,
  };
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const requestedSubdir = sanitizeSyncSubdirectory(
    options.syncSubdirectory || DEFAULT_SYNC_SUBDIRECTORY
  );
  const syncMode = options.syncMode === "summary" ? "summary" : "both";
  const shouldDownloadAudio = syncMode !== "summary";
  const stats = makeSyncStats();
  const sourceUrl = deps.getCurrentPlaudSourceUrl();
  let syncIndex = await deps.loadSyncIndex();
  syncIndex.settings = {
    ...syncIndex.settings,
    storageMode: "downloads_subfolder",
    syncSubdirectory: requestedSubdir,
    syncMode,
  };
  await deps.saveSyncIndex(syncIndex);

  function progress(patch = {}) {
    Object.assign(stats, patch);
    onProgress?.({ ...stats });
  }

  const session = await deps.getPlaudSession();
  let files = await deps.fetchPlaudFilesFromApi(session);
  deps.mergeDomRecordingIdsIntoFiles(files, {
    unfiledLabel: PLAUD_FOLDER_UNFILED,
  });
  deps.mergeLocalStorageRecordingIdsIntoFiles(files);
  stats.total = files.length;
  progress({ lastMessage: `Найдено записей: ${files.length}` });

  for (const file of files) {
    await deps.processSmartSyncFile({
      session,
      file,
      syncIndex,
      stats,
      progress,
      requestedSubdir,
      shouldDownloadAudio,
      sourceUrl,
    });
  }

  stats.status = "completed";
  stats.finishedAt = Date.now();
  stats.lastMessage = `Готово: ${stats.new} новых, ${stats.updated} обновлено, ${stats.skipped} пропущено.`;
  progress();
  return stats;
}
