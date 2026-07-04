import {
  DEFAULT_SYNC_SUBDIRECTORY,
  normalizeExportMode,
} from "../common/exportPathUtils.js";
import { loadSyncIndex, patchSyncSettings } from "../common/storageUtils.js";
import { sanitizeSyncSubdirectory } from "../common/syncCore.js";
import {
  ACTION_CHECK_SHOULD_STOP,
  ACTION_DOWNLOAD_PLAUD_FILE,
  ACTION_EXPORT_COMPLETE,
  ACTION_EXPORT_PROGRESS_UPDATE,
  ACTION_FOREGROUND_EXPORT_COMPLETE,
  ACTION_GET_ANY_RUNNING_EXPORT,
  ACTION_GET_EXPORT_STATUS,
  ACTION_GET_SMART_SYNC_STATUS,
  ACTION_GET_SYNC_SETTINGS,
  ACTION_LIBRARY_STATS_PROGRESS,
  ACTION_SET_SYNC_MODE,
  ACTION_SET_SYNC_SUBDIRECTORY,
  ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER,
  ACTION_SMART_SYNC_COMPLETE,
  ACTION_SMART_SYNC_PROGRESS,
  ACTION_SMART_SYNC_STATUS_UPDATE,
  ACTION_START_BACKGROUND_EXPORT,
  ACTION_START_SMART_SYNC,
  ACTION_STOP_EXPORT,
  ACTION_STOP_EXPORT_PROCESS,
} from "../common/runtimeMessages.js";
import { plaudT } from "./bgLocale.js";
import { sendTabMessage } from "./tabMessaging.js";
import { downloadPlaudFile } from "./chromeDownloadBridge.js";
import {
  createSyncNotification,
  refreshSyncNotificationSetting,
} from "./syncNotifications.js";
import {
  activeExports,
  activeTabIds,
  clearStallNotifyState,
  PING_STALE_AFTER_MS,
  persistExportStateToSession,
  stopFlags,
} from "./exportStateStore.js";
import {
  activeSmartSyncs,
  activeSmartSyncTabIds,
  persistSmartSyncStateToSession,
} from "./smartSyncStateStore.js";
import {
  getExportModeLabel,
  startBackgroundExport,
  verifyExportTabAlive,
} from "./exportOrchestrator.js";
import { startSmartSync, summarizeSyncIndex } from "./smartSyncOrchestrator.js";
import { ensureSessionRestored } from "./sessionBootstrap.js";

/**
 * @param {(...args: unknown[]) => void} plaudBgLog
 */
export function registerMessageRouter(plaudBgLog) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    plaudBgLog("Background received message:", message.action);

    try {
      if (message.action === ACTION_STOP_EXPORT) {
        const tabId = message.tabId;
        if (activeTabIds.has(tabId)) {
          stopFlags.add(tabId);
          activeTabIds.delete(tabId);

          if (activeExports[tabId]) {
            activeExports[tabId].status = "stopped";
          }
          persistExportStateToSession();
          clearStallNotifyState(tabId);

          sendTabMessage(tabId, { action: ACTION_STOP_EXPORT_PROCESS }).catch(
            (error) => console.warn("Failed to send stop message:", error)
          );

          createSyncNotification({
            type: "basic",
            iconUrl: "assets/icons/icon128.png",
            title: plaudT("bg.stopTitle"),
            message: plaudT("bg.stopMessage"),
            priority: 1,
          });
        }

        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_CHECK_SHOULD_STOP) {
        const tabId = sender.tab?.id;
        const shouldStop = stopFlags.has(tabId);
        sendResponse({ shouldStop });
        return false;
      }

      if (message.action === ACTION_START_BACKGROUND_EXPORT) {
        const tabId = message.tabId;
        if (!Number.isInteger(tabId)) {
          sendResponse({ success: false, error: plaudT("bg.badTabId") });
          return false;
        }

        startBackgroundExport(tabId, message.exportMode)
          .then((result) => sendResponse(result))
          .catch((error) => {
            console.warn("Failed to start background export:", error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      if (message.action === ACTION_START_SMART_SYNC) {
        const tabId = message.tabId;
        if (!Number.isInteger(tabId)) {
          sendResponse({ success: false, error: plaudT("bg.badTabId") });
          return false;
        }

        startSmartSync(tabId, message.syncSubdirectory, message.syncMode)
          .then((result) => sendResponse(result))
          .catch((error) => {
            console.warn("Failed to start smart sync:", error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      if (message.action === ACTION_SMART_SYNC_PROGRESS) {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          activeSmartSyncTabIds.add(tabId);
          activeSmartSyncs[tabId] = {
            ...(activeSmartSyncs[tabId] || {}),
            ...(message.data || {}),
            status: "running",
            lastUpdateTime: Date.now(),
          };
          persistSmartSyncStateToSession();
          chrome.runtime
            .sendMessage({
              action: ACTION_SMART_SYNC_STATUS_UPDATE,
              data: activeSmartSyncs[tabId],
              tabId,
            })
            .catch(() => {});
        }
        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_SMART_SYNC_COMPLETE) {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          const data = message.data || {};
          const isError = data.status === "error" || !!data.error;
          activeSmartSyncs[tabId] = {
            ...(activeSmartSyncs[tabId] || {}),
            ...data,
            status: isError ? "error" : "completed",
            finishedAt: Date.now(),
            lastUpdateTime: Date.now(),
          };
          activeSmartSyncTabIds.delete(tabId);
          persistSmartSyncStateToSession();
          chrome.runtime
            .sendMessage({
              action: ACTION_SMART_SYNC_STATUS_UPDATE,
              data: activeSmartSyncs[tabId],
              tabId,
            })
            .catch(() => {});
          createSyncNotification({
            type: "basic",
            iconUrl: "assets/icons/icon128.png",
            title: isError
              ? plaudT("sync.notifyErrorTitle")
              : plaudT("sync.notifyDoneTitle"),
            message: isError
              ? data.error || plaudT("sync.notifyErrorMessage")
              : plaudT("sync.notifyDoneMessage", {
                  n: Number(data.new) || 0,
                  u: Number(data.updated) || 0,
                  s: Number(data.skipped) || 0,
                }),
            priority: isError ? 2 : 1,
          });
        }
        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_GET_SMART_SYNC_STATUS) {
        const tabId = message.tabId;
        const data = Number.isInteger(tabId)
          ? activeSmartSyncs[tabId] || null
          : null;
        if (
          Number.isInteger(tabId) &&
          data?.status === "running" &&
          Date.now() -
            (Number(data.lastUpdateTime) || Number(data.startedAt) || 0) >
            PING_STALE_AFTER_MS
        ) {
          activeSmartSyncTabIds.delete(tabId);
          activeSmartSyncs[tabId] = {
            ...data,
            status: "error",
            error: plaudT("sync.staleMessage"),
            finishedAt: Date.now(),
            lastUpdateTime: Date.now(),
          };
          persistSmartSyncStateToSession();
        }
        const freshData = Number.isInteger(tabId)
          ? activeSmartSyncs[tabId] || null
          : null;
        sendResponse({
          success: true,
          isRunning:
            Number.isInteger(tabId) &&
            activeSmartSyncTabIds.has(tabId) &&
            freshData?.status === "running",
          syncData: freshData,
        });
        return false;
      }

      if (message.action === ACTION_GET_SYNC_SETTINGS) {
        loadSyncIndex()
          .then((index) => {
            sendResponse({
              success: true,
              settings: {
                storageMode: "downloads_subfolder",
                syncSubdirectory:
                  index.settings?.syncSubdirectory || DEFAULT_SYNC_SUBDIRECTORY,
                syncMode:
                  index.settings?.syncMode === "summary" ? "summary" : "both",
              },
              summary: summarizeSyncIndex(index),
            });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      if (message.action === ACTION_SET_SYNC_SUBDIRECTORY) {
        const syncSubdirectory = sanitizeSyncSubdirectory(
          message.syncSubdirectory
        );
        patchSyncSettings({
          storageMode: "downloads_subfolder",
          syncSubdirectory,
        })
          .then((index) => {
            refreshSyncNotificationSetting().catch(() => {});
            sendResponse({
              success: true,
              settings: index.settings,
              summary: summarizeSyncIndex(index),
            });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      if (message.action === ACTION_SET_SYNC_MODE) {
        const syncMode = message.syncMode === "summary" ? "summary" : "both";
        patchSyncSettings({ syncMode })
          .then((index) => {
            sendResponse({
              success: true,
              settings: index.settings,
            });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      if (message.action === ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER) {
        try {
          chrome.downloads.showDefaultFolder();
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        return false;
      }

      if (message.action === ACTION_EXPORT_PROGRESS_UPDATE) {
        const tabId = sender.tab?.id;
        const raw = message.data || {};
        const progressData = Object.fromEntries(
          Object.entries(raw).filter(([, value]) => value !== undefined)
        );

        if (tabId && activeExports[tabId]) {
          const previousNotified =
            activeExports[tabId].lastNotifiedProcessed || 0;
          const processed = Number(progressData.filesProcessed) || 0;

          activeExports[tabId] = {
            ...activeExports[tabId],
            ...progressData,
            lastUpdateTime: Date.now(),
            lastNotifiedProcessed: previousNotified,
          };

          if (
            processed % 10 === 0 &&
            processed > 0 &&
            processed !== previousNotified
          ) {
            createSyncNotification({
              type: "basic",
              iconUrl: "assets/icons/icon128.png",
              title: plaudT("bg.progressTitle"),
              message: plaudT("bg.progressMessage", { n: processed }),
              priority: 1,
            });
            activeExports[tabId].lastNotifiedProcessed = processed;
          }
          persistExportStateToSession();
          clearStallNotifyState(tabId);
        }

        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_EXPORT_COMPLETE) {
        const tabId = sender.tab?.id;

        if (tabId && activeExports[tabId]) {
          const stats = message.data || {};
          const processed = Number(stats.filesProcessed) || 0;
          const errored = Number(stats.filesErrored) || 0;
          activeExports[tabId].status = "completed";
          activeExports[tabId].filesProcessed = processed;
          activeExports[tabId].filesErrored = errored;
          if (
            stats.filesTotal !== undefined &&
            stats.filesTotal !== null &&
            stats.filesTotal !== ""
          ) {
            const ft = Number(stats.filesTotal);
            if (Number.isFinite(ft)) {
              activeExports[tabId].filesTotal = ft;
            }
          }
          activeExports[tabId].audioExported = Number(stats.audioExported) || 0;
          activeExports[tabId].audioErrors = Number(stats.audioErrors) || 0;
          activeExports[tabId].summariesExported =
            Number(stats.summariesExported) || 0;
          activeExports[tabId].summaryErrors = Number(stats.summaryErrors) || 0;
          activeExports[tabId].exportMode = stats.exportMode
            ? normalizeExportMode(stats.exportMode)
            : activeExports[tabId].exportMode;

          persistExportStateToSession();
          clearStallNotifyState(tabId);

          createSyncNotification({
            type: "basic",
            iconUrl: "assets/icons/icon128.png",
            title: plaudT("bg.completeTitle", {
              mode: getExportModeLabel(activeExports[tabId].exportMode),
            }),
            message: plaudT("bg.completeMessage", {
              audio: activeExports[tabId].audioExported,
              summary: activeExports[tabId].summariesExported,
              errors: errored,
            }),
            priority: 2,
          });

          setTimeout(() => {
            delete activeExports[tabId];
            activeTabIds.delete(tabId);
            stopFlags.delete(tabId);
            clearStallNotifyState(tabId);
            persistExportStateToSession();
            plaudBgLog(`Cleaned up export data for tab ${tabId}`);
          }, 60000);
        }

        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_FOREGROUND_EXPORT_COMPLETE) {
        plaudBgLog("foregroundExportComplete tab", message.tabId);
        chrome.runtime
          .sendMessage({
            action: ACTION_FOREGROUND_EXPORT_COMPLETE,
            tabId: message.tabId,
            data: message.data,
          })
          .catch(() => {});
        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_GET_EXPORT_STATUS) {
        const tabId = message.tabId;
        (async () => {
          await ensureSessionRestored();
          const data = activeExports[tabId] || null;
          const tabTracked = activeTabIds.has(tabId);
          if (tabTracked && data?.status === "running") {
            const ok = await verifyExportTabAlive(tabId);
            if (!ok) {
              const last = Number(data.lastUpdateTime) || 0;
              if (!last || Date.now() - last > PING_STALE_AFTER_MS) {
                activeTabIds.delete(tabId);
                stopFlags.delete(tabId);
                delete activeExports[tabId];
                clearStallNotifyState(tabId);
                persistExportStateToSession();
                sendResponse({
                  success: true,
                  isRunning: false,
                  exportData: null,
                });
                return;
              }
            }
          }
          const entry = activeExports[tabId] || null;
          const isRunning =
            activeTabIds.has(tabId) && entry?.status === "running";
          sendResponse({
            success: true,
            isRunning,
            exportData: entry,
          });
        })();
        return true;
      }

      if (message.action === ACTION_GET_ANY_RUNNING_EXPORT) {
        (async () => {
          await ensureSessionRestored();
          for (const tid of activeTabIds) {
            const entry = activeExports[tid];
            if (entry?.status !== "running") continue;
            const ok = await verifyExportTabAlive(tid);
            if (!ok) {
              const last = Number(entry.lastUpdateTime) || 0;
              if (!last || Date.now() - last > PING_STALE_AFTER_MS) {
                activeTabIds.delete(tid);
                stopFlags.delete(tid);
                delete activeExports[tid];
                clearStallNotifyState(tid);
                persistExportStateToSession();
                continue;
              }
            }
            sendResponse({
              success: true,
              isRunning: true,
              exportData: entry,
              tabId: tid,
            });
            return;
          }
          sendResponse({
            success: true,
            isRunning: false,
            exportData: null,
            tabId: null,
          });
        })();
        return true;
      }

      if (message.action === ACTION_LIBRARY_STATS_PROGRESS) {
        if (sender.tab) {
          chrome.runtime
            .sendMessage({
              action: ACTION_LIBRARY_STATS_PROGRESS,
              data: message.data,
            })
            .catch(() => {});
        }
        sendResponse({ success: true });
        return false;
      }

      if (message.action === ACTION_DOWNLOAD_PLAUD_FILE) {
        downloadPlaudFile(message)
          .then((result) => sendResponse(result))
          .catch((error) => {
            console.error("Failed to download Plaud file:", error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      console.warn("Unrecognized message action received:", message.action);
      sendResponse({ success: false, error: plaudT("bg.unknownAction") });
      return false;
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  });
}
