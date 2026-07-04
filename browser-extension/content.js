/**
 * Loads export modules and sets up message listeners for export actions.
 */
if (window.__plaudExporterContentLoaded) {
  console.log("Расширение Plaud уже загружено.");
} else {
  window.__plaudExporterContentLoaded = true;

  // Flag to indicate if the export process is running in background mode.
  let isBackgroundExporting = false;
  // Flag to signal when the export process should stop.
  let shouldStopExport = false;
  let exportRunLock = false;
  let libraryStatsLock = false;
  let smartSyncLock = false;

  /** @type {null | ((backgroundMode?: boolean, options?: object) => Promise<object>)} */
  let runExportAll = null;
  /** @type {null | ((options?: object) => Promise<object>)} */
  let runLibraryStats = null;
  /** @type {null | ((options?: object) => Promise<object>)} */
  let runSmartSync = null;
  /** @type {null | Function} */
  let resolveCurrentRecording = null;
  let initError = null;

  const initPromise = (async () => {
    try {
      console.log("Загрузка модулей…");
      const audioExportModule = await import(
        chrome.runtime.getURL("features/audioExport/audioExport.js")
      );
      const resolverModule = await import(
        chrome.runtime.getURL(
          "features/audioExport/currentRecordingResolver.js"
        )
      );
      runExportAll = audioExportModule.runExportAll;
      runLibraryStats = audioExportModule.runLibraryStats;
      runSmartSync = audioExportModule.runSmartSync;
      resolveCurrentRecording = resolverModule.resolveCurrentRecording;
    } catch (error) {
      initError = error;
      console.error("❌ Не удалось загрузить модули расширения:", error);
      throw error;
    }
  })();

  initPromise.catch(() => {
    window.__plaudExporterContentLoaded = false;
  });

  /**
   * Set up a listener for messages from other parts of the extension.
   * Registered synchronously so tabs.sendMessage works while imports are in flight.
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "plaudExportPing") {
      let currentRecording;
      try {
        currentRecording = resolveCurrentRecording?.() ?? null;
      } catch {
        currentRecording = null;
      }
      sendResponse({
        alive: true,
        backgroundExporting: isBackgroundExporting,
        exportRunLock,
        libraryStatsLock,
        smartSyncLock,
        currentRecording,
      });
      return false;
    }

    if (request.action === "stopExportProcess") {
      console.log(
        "Получен сигнал остановки — после текущего файла экспорт прервётся"
      );
      shouldStopExport = true;
      sendResponse({
        success: true,
        message: "Экспорт остановится после завершения текущего файла.",
      });
      return false;
    }

    if (request.action === "checkShouldStop") {
      sendResponse({ shouldStop: shouldStopExport });
      return false;
    }

    if (request.action === "runExportAll") {
      const senderTabId = sender.tab?.id;
      (async () => {
        try {
          await initPromise;
        } catch {
          sendResponse({
            success: false,
            error:
              initError?.message ||
              "Не удалось загрузить модуль экспорта. Обновите страницу Plaud Web.",
          });
          return;
        }
        if (!runExportAll) {
          sendResponse({
            success: false,
            error: "Модуль экспорта не готов. Обновите страницу.",
          });
          return;
        }

        if (exportRunLock) {
          sendResponse({
            success: false,
            error:
              "Экспорт уже выполняется на этой вкладке. Дождитесь завершения или остановите процесс.",
          });
          return;
        }

        const wasBackground = !!request.background;
        isBackgroundExporting = wasBackground;
        const exportMode = request.exportMode || "both";
        shouldStopExport = false;

        exportRunLock = true;
        sendResponse({ success: true, message: "Запуск экспорта…" });

        let foregroundResult = null;
        runExportAll(isBackgroundExporting, { exportMode })
          .then((result) => {
            foregroundResult = result;
            if (isBackgroundExporting) {
              chrome.runtime
                .sendMessage({
                  action: "exportComplete",
                  data: result,
                })
                .catch((err) => {
                  console.error(
                    "Не удалось отправить сообщение о завершении:",
                    err
                  );
                });
            }
          })
          .catch((error) => {
            console.error("Сбой экспорта:", error);
            foregroundResult = {
              filesProcessed: 0,
              filesErrored: 1,
              exportMode,
              error: error.message,
            };
            if (isBackgroundExporting) {
              chrome.runtime
                .sendMessage({
                  action: "exportComplete",
                  data: foregroundResult,
                })
                .catch((err) => {
                  console.error(
                    "Не удалось отправить сообщение об ошибке:",
                    err
                  );
                });
            }
          })
          .finally(() => {
            exportRunLock = false;
            if (wasBackground) {
              isBackgroundExporting = false;
            } else if (senderTabId != null) {
              chrome.runtime
                .sendMessage({
                  action: "foregroundExportComplete",
                  tabId: senderTabId,
                  data: foregroundResult || undefined,
                })
                .catch(() => {});
            }
          });
      })();
      return true;
    }

    if (request.action === "runExportCurrentPage") {
      const senderTabId = sender.tab?.id;
      (async () => {
        try {
          await initPromise;
        } catch {
          sendResponse({
            success: false,
            error:
              initError?.message ||
              "Не удалось загрузить модули. Обновите страницу Plaud Web.",
          });
          return;
        }
        if (!runExportAll || !resolveCurrentRecording) {
          sendResponse({
            success: false,
            error: "Модуль экспорта не готов. Обновите страницу.",
          });
          return;
        }

        if (exportRunLock) {
          sendResponse({
            success: false,
            error:
              "Экспорт уже выполняется на этой вкладке. Дождитесь завершения или остановите процесс.",
          });
          return;
        }

        try {
          const file = resolveCurrentRecording();
          if (!file?.id) {
            sendResponse({
              success: false,
              errorKey: "currentRecordingNotFound",
            });
            return;
          }
          const exportMode = request.exportMode || "both";
          isBackgroundExporting = false;
          shouldStopExport = false;
          exportRunLock = true;
          sendResponse({ success: true, message: "Запуск экспорта…" });

          let foregroundResult = null;
          runExportAll(false, { exportMode, singleFile: file })
            .then((result) => {
              foregroundResult = result;
            })
            .catch((error) => {
              console.error("Сбой экспорта текущей записи:", error);
              foregroundResult = {
                filesProcessed: 0,
                filesErrored: 1,
                exportMode,
                error: error.message,
              };
            })
            .finally(() => {
              exportRunLock = false;
              if (senderTabId != null) {
                chrome.runtime
                  .sendMessage({
                    action: "foregroundExportComplete",
                    tabId: senderTabId,
                    data: foregroundResult || undefined,
                  })
                  .catch(() => {});
              }
            });
        } catch (error) {
          sendResponse({
            success: false,
            error:
              error?.message || "Не удалось начать экспорт текущей записи.",
          });
        }
      })();
      return true;
    }

    if (request.action === "runLibraryStats") {
      let responded = false;
      function reply(payload) {
        if (responded) return;
        responded = true;
        try {
          sendResponse(payload);
        } catch {
          // ignore duplicate responses
        }
      }

      const includeSummaries = request.includeSummaries === true;

      (async () => {
        try {
          await initPromise;
        } catch {
          reply({
            success: false,
            error:
              initError?.message ||
              "Не удалось загрузить модуль. Обновите страницу Plaud Web.",
          });
          return;
        }
        if (!runLibraryStats) {
          reply({
            success: false,
            error: "Модуль статистики не готов. Обновите страницу.",
          });
          return;
        }

        if (exportRunLock) {
          reply({
            success: false,
            error:
              "Сейчас выполняется экспорт. Дождитесь его завершения и снова обновите статистику.",
          });
          return;
        }

        if (libraryStatsLock) {
          reply({
            success: false,
            error: "Подсчёт архива уже выполняется на этой вкладке.",
          });
          return;
        }

        libraryStatsLock = true;
        try {
          const result = await runLibraryStats({
            includeSummaries,
            onProgress: (data) => {
              chrome.runtime
                .sendMessage({
                  action: "libraryStatsProgress",
                  data,
                })
                .catch(() => {});
            },
          });
          reply({
            success: true,
            recordings: result.recordings,
            summaries: result.summaries,
            libraryStatsNote: result.libraryStatsNote,
          });
        } catch (error) {
          reply({
            success: false,
            error: error?.message || String(error),
          });
        } finally {
          libraryStatsLock = false;
        }
      })();
      return true;
    }

    if (request.action === "runSmartSync") {
      let responded = false;
      function reply(payload) {
        if (responded) return;
        responded = true;
        try {
          sendResponse(payload);
        } catch {
          // ignore duplicate responses
        }
      }

      (async () => {
        try {
          await initPromise;
        } catch {
          reply({
            success: false,
            error:
              initError?.message ||
              "Не удалось загрузить модуль синхронизации. Обновите страницу Plaud Web.",
          });
          return;
        }
        if (!runSmartSync) {
          reply({
            success: false,
            error: "Модуль синхронизации не готов. Обновите страницу.",
          });
          return;
        }
        if (exportRunLock) {
          reply({
            success: false,
            error:
              "Сейчас выполняется экспорт. Дождитесь завершения и повторите синхронизацию.",
          });
          return;
        }
        if (smartSyncLock) {
          reply({
            success: false,
            error: "Синхронизация уже выполняется на этой вкладке.",
          });
          return;
        }

        smartSyncLock = true;
        reply({ success: true, message: "Синхронизация запущена…" });
        try {
          const result = await runSmartSync({
            syncSubdirectory: request.syncSubdirectory,
            syncMode: request.syncMode,
            onProgress: (data) => {
              chrome.runtime
                .sendMessage({
                  action: "smartSyncProgress",
                  data,
                })
                .catch(() => {});
            },
          });
          chrome.runtime
            .sendMessage({
              action: "smartSyncComplete",
              data: result,
            })
            .catch(() => {});
        } catch (error) {
          chrome.runtime
            .sendMessage({
              action: "smartSyncComplete",
              data: {
                status: "error",
                error: error?.message || String(error),
              },
            })
            .catch(() => {});
        } finally {
          smartSyncLock = false;
        }
      })();
      return true;
    }

    return false;
  });

  window.addEventListener("beforeunload", function (e) {
    if (isBackgroundExporting) {
      e.preventDefault();
      e.returnValue = "Идёт экспорт. Покинуть страницу?";
      return e.returnValue;
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (isBackgroundExporting && document.visibilityState === "hidden") {
      console.log("Страница скрыта, фоновый экспорт продолжается");
    }
  });
}
