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
 * @param {{ syncSubdirectory?: string; onProgress?: (stats: object) => void; syncMode?: string }} [options]
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
    await processSmartSyncFile({
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
