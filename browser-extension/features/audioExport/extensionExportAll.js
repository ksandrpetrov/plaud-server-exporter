/**
 * features/audioExport/extensionExportAll.js
 * Full Plaud export through Plaud Web's API.
 */
import {
  createStatusIndicator,
  updateIndicator,
} from "../../common/uiComponents.js";
import {
  EXPORT_MODE_AUDIO,
  EXPORT_MODE_BOTH,
  EXPORT_MODE_SUMMARY,
  getExportModeLabel,
  normalizeExportMode,
} from "../../common/exportPathUtils.js";
import {
  normalizeHumanTitle,
  preferApiTitle,
} from "../../common/plaudTitles.js";
import { normalizeHexRecordingId } from "../../common/plaudRecordingIds.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import {
  ACTION_CHECK_SHOULD_STOP,
  ACTION_EXPORT_PROGRESS_UPDATE,
} from "../../common/runtimeMessages.js";
import {
  fetchPlaudFilesFromApi,
  PLAUD_API_MAX_FILES,
  plaudExportDebug,
} from "./plaudBrowserApi.js";
import {
  describePlaudSessionStorage,
  getPlaudSession,
} from "./plaudBrowserSession.js";
import {
  buildDownloadFilename,
  reservePlannedDownloadPath,
} from "./plaudCollisionPaths.js";
import {
  buildSummaryFilenameForFile,
  downloadTextViaBackground,
  downloadViaBackground,
} from "./extensionDownloadBridge.js";
import {
  fetchPlaudAudioUrl,
  fetchPlaudSummaryExports,
  tryFetchRecordingTitleHint,
} from "./plaudMediaFetch.js";
import {
  mergeDomRecordingIdsIntoFiles,
  mergeLocalStorageRecordingIdsIntoFiles,
} from "./plaudRecordingIdScraper.js";

/**
 * Exports Plaud files through Plaud Web's current API. When the session or
 * list is unavailable it fails closed and never clicks page controls.
 *
 * @param {boolean} backgroundMode - Whether the export runs in background mode.
 * @param {{
 *   exportMode?: PlaudExportMode;
 *   singleFile?: Pick<PlaudRecording, "id" | "title">;
 *   tr?: (key: string, params?: Record<string, unknown>) => string;
 *   _deps?: Partial<{
 *     createStatusIndicator: typeof createStatusIndicator;
 *     updateIndicator: typeof updateIndicator;
 *     getPlaudSession: typeof getPlaudSession;
 *     fetchPlaudFilesFromApi: typeof fetchPlaudFilesFromApi;
 *     mergeDomRecordingIdsIntoFiles: typeof mergeDomRecordingIdsIntoFiles;
 *     mergeLocalStorageRecordingIdsIntoFiles: typeof mergeLocalStorageRecordingIdsIntoFiles;
 *     fetchPlaudAudioUrl: typeof fetchPlaudAudioUrl;
 *     fetchPlaudSummaryExports: typeof fetchPlaudSummaryExports;
 *     tryFetchRecordingTitleHint: typeof tryFetchRecordingTitleHint;
 *     downloadViaBackground: typeof downloadViaBackground;
 *     downloadTextViaBackground: typeof downloadTextViaBackground;
 *     scheduleIndicatorRemoval: (callback: () => void, delayMs: number) => unknown;
 *   }>;
 * }} [options] Export options and internal test dependencies.
 * @returns {Promise<ExportStats>} Export statistics.
 */
export async function runExportAll(backgroundMode = false, options = {}) {
  const deps = {
    createStatusIndicator,
    updateIndicator,
    getPlaudSession,
    fetchPlaudFilesFromApi,
    mergeDomRecordingIdsIntoFiles,
    mergeLocalStorageRecordingIdsIntoFiles,
    fetchPlaudAudioUrl,
    fetchPlaudSummaryExports,
    tryFetchRecordingTitleHint,
    downloadViaBackground,
    downloadTextViaBackground,
    scheduleIndicatorRemoval: (callback, delayMs) =>
      setTimeout(callback, delayMs),
    ...options._deps,
  };
  const exportMode = /** @type {PlaudExportMode} */ (
    normalizeExportMode(options.exportMode)
  );
  const tr =
    options.tr ??
    ((key) => {
      const I = globalThis.PlaudI18n;
      if (!I) return key;
      return I.t(I.getDefaultLocaleFromNavigator(), key);
    });
  const modeLabel = (mode) => getExportModeLabel(mode, tr);
  const shouldExportAudio =
    exportMode === EXPORT_MODE_BOTH || exportMode === EXPORT_MODE_AUDIO;
  const shouldExportSummaries =
    exportMode === EXPORT_MODE_BOTH || exportMode === EXPORT_MODE_SUMMARY;
  const indicator = deps.createStatusIndicator();
  console.log(
    `Запуск экспорта Plaud (${modeLabel(exportMode)}, фон: ${backgroundMode})…`
  );
  const stats = {
    exportMode,
    filesProcessed: 0,
    filesErrored: 0,
    filesSkipped: 0,
    audioExported: 0,
    audioErrors: 0,
    summariesExported: 0,
    summariesSkipped: 0,
    summaryErrors: 0,
    startTime: Date.now(),
  };
  const plannedDownloadPaths = new Set();

  /**
   * Updates progress statistics and sends periodic progress notifications in background mode.
   * @param {string} current - The title of the current file.
   * @param {boolean} [error=false] - Flag indicating if an error occurred.
   */
  const updateProgress = (current, error = false) => {
    if (error) {
      stats.filesErrored++;
    } else {
      stats.filesProcessed++;
    }
    if (backgroundMode) {
      try {
        chrome.runtime
          .sendMessage({
            action: ACTION_EXPORT_PROGRESS_UPDATE,
            data: { ...stats, currentTitle: current },
          })
          .catch((e) => console.warn("Failed to send progress update:", e));
      } catch (e) {
        console.warn("Error sending progress update:", e);
      }
    }
  };

  /**
   * Checks if the export process should stop.
   * @returns {Promise<boolean>} - Whether the export should stop.
   */
  async function shouldStopExport() {
    if (!backgroundMode) return false;
    try {
      return chrome.runtime
        .sendMessage({ action: ACTION_CHECK_SHOULD_STOP })
        .then((response) => response?.shouldStop)
        .catch(() => false);
    } catch (e) {
      console.warn("Error checking stop status:", e);
      return false;
    }
  }

  let fileCount = 0;
  let errorCount = 0;
  const maxErrors = 3;
  async function tryDirectApiExport() {
    let session;
    try {
      session = await deps.getPlaudSession();
    } catch (error) {
      console.warn("[Plaud Export] api-session:unavailable", {
        message: error?.message || String(error),
        storage: describePlaudSessionStorage(),
        error,
      });
      return false;
    }
    plaudExportDebug("api-session:ready", {
      apiBase: session.apiBase,
      hasAuthHeader: !!session.authHeader,
      hasUserAuthHeader: !!session.userAuthHeader,
      hasWorkspaceAuthHeader: !!session.workspaceAuthHeader,
      hasWorkspaceId: !!session.workspaceId,
      sortBy: session.sortBy,
      tokenSource: session.tokenSource || "",
      storage: describePlaudSessionStorage(),
    });

    let files;
    if (options.singleFile?.id) {
      const sf = options.singleFile;
      const id =
        normalizeHexRecordingId(sf.id) ||
        String(sf.id || "")
          .trim()
          .toLowerCase();
      const title =
        normalizeHumanTitle(
          String(sf.title || sf.id)
            .replace(/\s+/g, " ")
            .trim()
        ) || id;
      files = [
        {
          id,
          title,
          raw: { file_id: id, file_name: title },
        },
      ];
    } else {
      try {
        files = await deps.fetchPlaudFilesFromApi(session);
        const apiCount = files.length;
        deps.mergeDomRecordingIdsIntoFiles(files, {
          unfiledLabel: PLAUD_FOLDER_UNFILED,
        });
        deps.mergeLocalStorageRecordingIdsIntoFiles(files, {
          maxExtraFromCache: Math.max(0, PLAUD_API_MAX_FILES - apiCount),
        });
      } catch (error) {
        console.warn("Could not read Plaud file list from API:", error.message);
        return false;
      }
    }

    if (files.length === 0) {
      throw new Error(
        "API Plaud вернул 0 файлов. Откройте нужное рабочее пространство с записями."
      );
    }

    stats.filesTotal = files.length;
    const intro = options.singleFile?.id
      ? `Текущая запись. Загрузка (${modeLabel(exportMode)})…`
      : `Найдено файлов: ${files.length}. Загрузка (${modeLabel(exportMode)})…`;
    deps.updateIndicator(indicator, intro);
    console.log(`Прямой экспорт по API: ${files.length} файл(ов).`);

    for (let file of files) {
      if (await shouldStopExport()) {
        deps.updateIndicator(
          indicator,
          `Экспорт остановлен после ${stats.filesProcessed} файл(ов).`,
          "info"
        );
        return true;
      }

      if (errorCount >= maxErrors) {
        throw new Error(`Остановка после ${maxErrors} ошибок подряд.`);
      }

      fileCount++;
      let fileHadFatalError = false;
      let fileHadAnySuccess = false;

      try {
        session = await deps.getPlaudSession();
      } catch (sessionError) {
        throw new Error(
          sessionError?.message ||
            "Сессия Plaud недоступна. Обновите вкладку Plaud Web и войдите снова.",
          { cause: sessionError }
        );
      }

      if (shouldExportAudio) {
        deps.updateIndicator(
          indicator,
          `Загрузка аудио №${fileCount}/${files.length}: ${file.title}…`
        );
        try {
          const { url, titleHint } = await deps.fetchPlaudAudioUrl(
            session,
            file.id
          );
          file = preferApiTitle(file, titleHint);
          const filename = reservePlannedDownloadPath(
            buildDownloadFilename(file, url),
            file.id,
            plannedDownloadPaths
          );
          await deps.downloadViaBackground(url, filename, {
            conflictAction: "overwrite",
          });
          stats.audioExported++;
          fileHadAnySuccess = true;
          console.log(`Downloaded "${file.title}" to ${filename}.`);
        } catch (audioError) {
          stats.audioErrors++;
          fileHadFatalError = true;
          console.error(
            `Direct audio download failed for "${file.title}":`,
            audioError.message
          );
          deps.updateIndicator(
            indicator,
            `Ошибка загрузки аудио №${fileCount}: ${audioError.message.substring(
              0,
              50
            )}…`,
            "error"
          );
        }
      }

      if (shouldExportSummaries && !shouldExportAudio) {
        const titleHint = await deps.tryFetchRecordingTitleHint(
          session,
          file.id
        );
        file = preferApiTitle(file, titleHint);
      }

      if (shouldExportSummaries) {
        deps.updateIndicator(
          indicator,
          `Загрузка саммари №${fileCount}/${files.length}: ${file.title}…`
        );
        try {
          const summaryExports = await deps.fetchPlaudSummaryExports(
            session,
            file
          );
          if (summaryExports.length > 0) {
            for (const [
              summaryIndex,
              summaryExport,
            ] of summaryExports.entries()) {
              await deps.downloadTextViaBackground(
                summaryExport.markdown,
                reservePlannedDownloadPath(
                  buildSummaryFilenameForFile(
                    summaryExport.markdown,
                    summaryExport.title || file.title,
                    summaryIndex,
                    file
                  ),
                  file.id,
                  plannedDownloadPaths
                ),
                { conflictAction: "overwrite" }
              );
              stats.summariesExported++;
              console.log(
                `Downloaded summary "${summaryExport.title}" for "${file.title}".`
              );
            }
            fileHadAnySuccess = true;
          } else {
            stats.summariesSkipped++;
            console.log(`No generated summary found for "${file.title}".`);
            if (exportMode === EXPORT_MODE_SUMMARY) {
              fileHadAnySuccess = true;
            }
          }
        } catch (summaryError) {
          const summaryErrorMessage =
            summaryError?.message || String(summaryError);
          stats.summaryErrors++;
          if (exportMode === EXPORT_MODE_SUMMARY) {
            fileHadFatalError = true;
          }
          console.warn("[Plaud Export] summary:export:error", {
            fileId: file.id,
            title: file.title,
            fileIndex: fileCount,
            totalFiles: files.length,
            message: summaryErrorMessage,
            stack: summaryError?.stack || "",
            error: summaryError,
          });
          deps.updateIndicator(
            indicator,
            `Ошибка загрузки саммари №${fileCount}: ${summaryErrorMessage.substring(
              0,
              50
            )}…`,
            "error"
          );
        }
      }

      if (fileHadFatalError || !fileHadAnySuccess) {
        errorCount++;
        updateProgress(file.title, true);
      } else {
        updateProgress(file.title);
        errorCount = 0;
      }
    }

    stats.endTime = Date.now();
    stats.duration = stats.endTime - stats.startTime;
    deps.updateIndicator(
      indicator,
      `Готово! Аудио: ${stats.audioExported}, саммари: ${stats.summariesExported}.`,
      stats.filesErrored ? "error" : "success"
    );
    deps.scheduleIndicatorRemoval(() => indicator.remove(), 6000);
    return true;
  }

  try {
    const directApiHandled = await tryDirectApiExport();
    if (directApiHandled) {
      return stats;
    }

    throw new Error(tr("error.contentDirectApiUnavailable"));
  } catch (error) {
    deps.updateIndicator(indicator, error?.message || String(error), "error");
    deps.scheduleIndicatorRemoval(() => indicator.remove(), 6000);
    throw error;
  }
}
