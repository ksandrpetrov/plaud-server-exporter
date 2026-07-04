/**
 * features/audioExport/extensionExportAll.js
 * Full Plaud export (API primary, DOM fallback).
 */
import {
  createStatusIndicator,
  updateIndicator,
} from "../../common/uiComponents.js";
import {
  EXPORT_MODE_AUDIO,
  EXPORT_MODE_BOTH,
  EXPORT_MODE_SUMMARY,
  normalizeExportMode,
} from "../../common/exportPathUtils.js";
import { normalizeHumanTitle } from "../../common/plaudTitles.js";
import { normalizeHexRecordingId } from "../../common/plaudRecordingIds.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import {
  ACTION_CHECK_SHOULD_STOP,
  ACTION_EXPORT_PROGRESS_UPDATE,
} from "../../common/runtimeMessages.js";
import {
  fetchPlaudFilesFromApi,
  getExportModeLabel,
  PLAUD_API_MAX_FILES,
  plaudExportDebug,
  preferApiTitle,
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
import { runDomExportFallback } from "./domExportFallback.js";

/**
 * Exports all Plaud audio files and updates progress. The primary path uses
 * Plaud Web's current API; the older DOM click flow remains as a fallback.
 *
 * @param {boolean} backgroundMode - Whether the export runs in background mode.
 * @param {Object} options - Export options.
 * @param {string} options.exportMode - One of "both", "audio", or "summary".
 * @param {{ id: string, title?: string }} [options.singleFile] - If set, export only this file via API (no full list fetch).
 * @returns {Object} stats - Export statistics including processed, errored, and skipped file counts.
 */
export async function runExportAll(backgroundMode = false, options = {}) {
  const exportMode = normalizeExportMode(options.exportMode);
  const shouldExportAudio =
    exportMode === EXPORT_MODE_BOTH || exportMode === EXPORT_MODE_AUDIO;
  const shouldExportSummaries =
    exportMode === EXPORT_MODE_BOTH || exportMode === EXPORT_MODE_SUMMARY;
  const indicator = createStatusIndicator();
  console.log(
    `Запуск экспорта Plaud (${getExportModeLabel(
      exportMode
    )}, фон: ${backgroundMode})…`
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
  const processedTitles = new Set();
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
  let directApiUnavailableError = null;

  async function tryDirectApiExport() {
    let session;
    try {
      session = await getPlaudSession();
    } catch (error) {
      directApiUnavailableError = error;
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
        files = await fetchPlaudFilesFromApi(session);
        const apiCount = files.length;
        mergeDomRecordingIdsIntoFiles(files, {
          unfiledLabel: PLAUD_FOLDER_UNFILED,
        });
        mergeLocalStorageRecordingIdsIntoFiles(files, {
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
      ? `Текущая запись. Загрузка (${getExportModeLabel(exportMode)})…`
      : `Найдено файлов: ${files.length}. Загрузка (${getExportModeLabel(
          exportMode
        )})…`;
    updateIndicator(indicator, intro);
    console.log(`Прямой экспорт по API: ${files.length} файл(ов).`);

    for (let file of files) {
      if (await shouldStopExport()) {
        updateIndicator(
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
        session = await getPlaudSession();
      } catch (sessionError) {
        throw new Error(
          sessionError?.message ||
            "Сессия Plaud недоступна. Обновите вкладку Plaud Web и войдите снова.",
          { cause: sessionError }
        );
      }

      if (shouldExportAudio) {
        updateIndicator(
          indicator,
          `Загрузка аудио №${fileCount}/${files.length}: ${file.title}…`
        );
        try {
          const { url, titleHint } = await fetchPlaudAudioUrl(session, file.id);
          file = preferApiTitle(file, titleHint);
          const filename = reservePlannedDownloadPath(
            buildDownloadFilename(file, url),
            file.id,
            plannedDownloadPaths
          );
          await downloadViaBackground(url, filename, {
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
          updateIndicator(
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
        const titleHint = await tryFetchRecordingTitleHint(session, file.id);
        file = preferApiTitle(file, titleHint);
      }

      if (shouldExportSummaries) {
        updateIndicator(
          indicator,
          `Загрузка саммари №${fileCount}/${files.length}: ${file.title}…`
        );
        try {
          const summaryExports = await fetchPlaudSummaryExports(session, file);
          if (summaryExports.length > 0) {
            for (const [
              summaryIndex,
              summaryExport,
            ] of summaryExports.entries()) {
              await downloadTextViaBackground(
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
          updateIndicator(
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
    updateIndicator(
      indicator,
      `Готово! Аудио: ${stats.audioExported}, саммари: ${stats.summariesExported}.`,
      stats.filesErrored ? "error" : "success"
    );
    setTimeout(() => indicator.remove(), 6000);
    return true;
  }

  try {
    const directApiHandled = await tryDirectApiExport();
    if (directApiHandled) {
      return stats;
    }

    if (options.singleFile?.id) {
      const reason = directApiUnavailableError
        ? ` Причина: ${
            directApiUnavailableError?.message ||
            String(directApiUnavailableError)
          }`
        : "";
      throw new Error(
        `Не удалось экспортировать эту запись через API.${reason}`
      );
    }
    if (shouldExportSummaries) {
      throw new Error(
        "Экспорт саммари нужен через API Plaud Web. Устаревший режим через страницу выгружает только аудио."
      );
    }
    return await runDomExportFallback({
      backgroundMode,
      indicator,
      stats,
      processedTitles,
      shouldStopExport,
      updateProgress,
    });
  } catch (error) {
    updateIndicator(indicator, error?.message || String(error), "error");
    setTimeout(() => indicator.remove(), 6000);
    throw error;
  }
}
