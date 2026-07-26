import { normalizeExportMode } from "../../common/exportPathUtils.js";
import {
  ACTION_CHECK_SHOULD_STOP,
  ACTION_EXPORT_COMPLETE,
  ACTION_EXPORT_PROGRESS_UPDATE,
  ACTION_FOREGROUND_EXPORT_COMPLETE,
  ACTION_START_BACKGROUND_EXPORT,
  ACTION_STOP_EXPORT,
  ACTION_STOP_EXPORT_PROCESS,
} from "../../common/runtimeMessages.js";
import { plaudT } from "../bgLocale.js";
import { sendTabMessage } from "../tabMessaging.js";
import { createSyncNotification } from "../syncNotifications.js";
import {
  activeExports,
  activeTabIds,
  clearStallNotifyState,
  persistExportStateToSession,
  stopFlags,
} from "../exportStateStore.js";
import {
  getExportModeLabel,
  startBackgroundExport,
} from "../exportOrchestrator.js";
import { ensureSessionRestored } from "../sessionBootstrap.js";

/**
 * @param {(...args: unknown[]) => void} plaudBgLog
 */
export function createExportHandlers(plaudBgLog) {
  return {
    [ACTION_STOP_EXPORT](message, _sender, sendResponse) {
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
    },

    [ACTION_CHECK_SHOULD_STOP](_message, sender, sendResponse) {
      const tabId = sender.tab?.id;
      sendResponse({ shouldStop: stopFlags.has(tabId) });
      return false;
    },

    [ACTION_START_BACKGROUND_EXPORT](message, _sender, sendResponse) {
      const tabId = message.tabId;
      if (!Number.isInteger(tabId)) {
        sendResponse({ success: false, error: plaudT("bg.badTabId") });
        return false;
      }

      (async () => {
        await ensureSessionRestored();
        try {
          sendResponse(await startBackgroundExport(tabId, message.exportMode));
        } catch (error) {
          console.warn("Failed to start background export:", error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    },

    [ACTION_EXPORT_PROGRESS_UPDATE](message, sender, sendResponse) {
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
    },

    [ACTION_EXPORT_COMPLETE](message, sender, sendResponse) {
      const tabId = sender.tab?.id;

      if (tabId && activeExports[tabId]) {
        const stats = /** @type {Record<string, any>} */ (message.data || {});
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
    },

    [ACTION_FOREGROUND_EXPORT_COMPLETE](message, _sender, sendResponse) {
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
    },
  };
}
