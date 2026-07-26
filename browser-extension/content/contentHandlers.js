/**
 * Content-script message handlers (ES module, loaded from content.js).
 */

import { smartSyncBusyErrorKey } from "./contentSyncLocks.js";

export { smartSyncBusyErrorKey } from "./contentSyncLocks.js";

/**
 * @param {ContentRuntimeState} state
 * @param {(key: string, params?: Record<string, unknown>) => string} contentTr
 */
export function registerContentMessageHandlers(state, contentTr) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "plaudExportPing") {
      let currentRecording;
      try {
        currentRecording = state.resolveCurrentRecording?.() ?? null;
      } catch {
        currentRecording = null;
      }
      sendResponse({
        alive: true,
        backgroundExporting: state.isBackgroundExporting,
        exportRunLock: state.exportRunLock,
        libraryStatsLock: state.libraryStatsLock,
        smartSyncLock: state.smartSyncLock,
        currentRecording,
      });
      return false;
    }

    if (request.action === "stopExportProcess") {
      console.log(
        "Получен сигнал остановки — после текущего файла экспорт прервётся"
      );
      state.shouldStopExport = true;
      sendResponse({
        success: true,
        message: contentTr("error.stopAfterFile"),
      });
      return false;
    }

    if (request.action === "checkShouldStop") {
      sendResponse({ shouldStop: state.shouldStopExport });
      return false;
    }

    if (request.action === "runExportAll") {
      handleRunExportAll(state, request, sender, sendResponse, contentTr);
      return true;
    }

    if (request.action === "runExportCurrentPage") {
      handleRunExportCurrentPage(
        state,
        request,
        sender,
        sendResponse,
        contentTr
      );
      return true;
    }

    if (request.action === "runLibraryStats") {
      handleRunLibraryStats(state, request, sendResponse, contentTr);
      return true;
    }

    if (request.action === "runSmartSync") {
      handleRunSmartSync(state, request, sendResponse, contentTr);
      return true;
    }

    return false;
  });
}

/**
 * @param {ContentRuntimeState} state
 * @param {Extract<RuntimeMessage, { action: "runExportAll" }>} request
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: RuntimeResponse) => void} sendResponse
 * @param {(key: string, params?: Record<string, unknown>) => string} contentTr
 */
function handleRunExportAll(state, request, sender, sendResponse, contentTr) {
  const senderTabId = sender.tab?.id;
  (async () => {
    try {
      await state.initPromise;
    } catch {
      sendResponse({
        success: false,
        error:
          state.initError?.message ||
          contentTr("error.contentExportModuleLoadFailed"),
      });
      return;
    }
    if (!state.runExportAll) {
      sendResponse({
        success: false,
        error: contentTr("error.contentExportModuleNotReady"),
      });
      return;
    }

    if (state.exportRunLock) {
      sendResponse({
        success: false,
        error: contentTr("error.contentExportLockBusy"),
      });
      return;
    }

    const wasBackground = !!request.background;
    state.isBackgroundExporting = wasBackground;
    const exportMode = request.exportMode || "both";
    state.shouldStopExport = false;

    state.exportRunLock = true;
    sendResponse({
      success: true,
      message: contentTr("error.contentExportStarting"),
    });

    let foregroundResult = null;
    state
      .runExportAll(state.isBackgroundExporting, { exportMode, tr: contentTr })
      .then((result) => {
        foregroundResult = result;
        if (state.isBackgroundExporting) {
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
        if (state.isBackgroundExporting) {
          chrome.runtime
            .sendMessage({
              action: "exportComplete",
              data: foregroundResult,
            })
            .catch((err) => {
              console.error("Не удалось отправить сообщение об ошибке:", err);
            });
        }
      })
      .finally(() => {
        state.exportRunLock = false;
        if (wasBackground) {
          state.isBackgroundExporting = false;
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
}

/**
 * @param {ContentRuntimeState} state
 * @param {Extract<RuntimeMessage, { action: "runExportCurrentPage" }>} request
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: RuntimeResponse) => void} sendResponse
 * @param {(key: string, params?: Record<string, unknown>) => string} contentTr
 */
function handleRunExportCurrentPage(
  state,
  request,
  sender,
  sendResponse,
  contentTr
) {
  const senderTabId = sender.tab?.id;
  (async () => {
    try {
      await state.initPromise;
    } catch {
      sendResponse({
        success: false,
        error:
          state.initError?.message ||
          contentTr("error.contentModuleLoadFailed"),
      });
      return;
    }
    if (!state.runExportAll || !state.resolveCurrentRecording) {
      sendResponse({
        success: false,
        error: contentTr("error.contentExportModuleNotReady"),
      });
      return;
    }

    if (state.exportRunLock) {
      sendResponse({
        success: false,
        error: contentTr("error.contentExportLockBusy"),
      });
      return;
    }

    try {
      const file = state.resolveCurrentRecording();
      if (!file?.id) {
        sendResponse({
          success: false,
          errorKey: "currentRecordingNotFound",
        });
        return;
      }
      const exportMode = request.exportMode || "both";
      state.isBackgroundExporting = false;
      state.shouldStopExport = false;
      state.exportRunLock = true;
      sendResponse({
        success: true,
        message: contentTr("error.contentExportStarting"),
      });

      let foregroundResult = null;
      state
        .runExportAll(false, { exportMode, singleFile: file, tr: contentTr })
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
          state.exportRunLock = false;
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
        error: error?.message || contentTr("error.couldNotStartCurrent"),
      });
    }
  })();
}

/**
 * @param {ContentRuntimeState} state
 * @param {Extract<RuntimeMessage, { action: "runLibraryStats" }>} request
 * @param {(response: RuntimeResponse) => void} sendResponse
 * @param {(key: string, params?: Record<string, unknown>) => string} contentTr
 */
function handleRunLibraryStats(state, request, sendResponse, contentTr) {
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
      await state.initPromise;
    } catch {
      reply({
        success: false,
        error:
          state.initError?.message ||
          contentTr("error.contentModuleLoadFailed"),
      });
      return;
    }
    if (!state.runLibraryStats) {
      reply({
        success: false,
        error: contentTr("error.contentStatsModuleNotReady"),
      });
      return;
    }

    if (state.exportRunLock) {
      reply({
        success: false,
        error: contentTr("error.waitExport"),
      });
      return;
    }

    if (state.libraryStatsLock) {
      reply({
        success: false,
        error: contentTr("error.contentStatsLockBusy"),
      });
      return;
    }

    state.libraryStatsLock = true;
    try {
      const result = await state.runLibraryStats({
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
      state.libraryStatsLock = false;
    }
  })();
}

/**
 * @param {ContentRuntimeState} state
 * @param {Extract<RuntimeMessage, { action: "runSmartSync" }>} request
 * @param {(response: RuntimeResponse) => void} sendResponse
 * @param {(key: string, params?: Record<string, unknown>) => string} contentTr
 */
function handleRunSmartSync(state, request, sendResponse, contentTr) {
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
      await state.initPromise;
    } catch {
      reply({
        success: false,
        error:
          state.initError?.message ||
          contentTr("error.contentSyncModuleLoadFailed"),
      });
      return;
    }
    if (!state.runSmartSync) {
      reply({
        success: false,
        error: contentTr("error.contentSyncModuleNotReady"),
      });
      return;
    }
    const busyKey = smartSyncBusyErrorKey(state);
    if (busyKey) {
      reply({
        success: false,
        error: contentTr(busyKey),
      });
      return;
    }

    state.smartSyncLock = true;
    reply({ success: true, message: contentTr("error.contentSyncStarting") });
    try {
      const result = await state.runSmartSync({
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
      state.smartSyncLock = false;
    }
  })();
}
