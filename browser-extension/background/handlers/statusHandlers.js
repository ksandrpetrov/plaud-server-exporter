import {
  ACTION_DOWNLOAD_PLAUD_FILE,
  ACTION_GET_ANY_RUNNING_EXPORT,
  ACTION_GET_EXPORT_STATUS,
  ACTION_LIBRARY_STATS_PROGRESS,
} from "../../common/runtimeMessages.js";
import { downloadPlaudFile } from "../chromeDownloadBridge.js";
import {
  activeExports,
  activeTabIds,
  clearStallNotifyState,
  PING_STALE_AFTER_MS,
  persistExportStateToSession,
  stopFlags,
} from "../exportStateStore.js";
import { verifyExportTabAlive } from "../exportOrchestrator.js";
import { ensureSessionRestored } from "../sessionBootstrap.js";

export function createStatusHandlers() {
  return {
    [ACTION_GET_EXPORT_STATUS](message, _sender, sendResponse) {
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
    },

    [ACTION_GET_ANY_RUNNING_EXPORT](_message, _sender, sendResponse) {
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
    },

    [ACTION_LIBRARY_STATS_PROGRESS](message, sender, sendResponse) {
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
    },

    [ACTION_DOWNLOAD_PLAUD_FILE](message, _sender, sendResponse) {
      downloadPlaudFile(message)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error("Failed to download Plaud file:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    },
  };
}
