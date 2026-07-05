import {
  ACTION_GET_SMART_SYNC_STATUS,
  ACTION_SMART_SYNC_COMPLETE,
  ACTION_SMART_SYNC_PROGRESS,
  ACTION_SMART_SYNC_STATUS_UPDATE,
  ACTION_START_SMART_SYNC,
} from "../../common/runtimeMessages.js";
import { plaudT } from "../bgLocale.js";
import { createSyncNotification } from "../syncNotifications.js";
import {
  activeSmartSyncs,
  activeSmartSyncTabIds,
  persistSmartSyncStateToSession,
} from "../smartSyncStateStore.js";
import { PING_STALE_AFTER_MS } from "../exportStateStore.js";
import { startSmartSync } from "../smartSyncOrchestrator.js";
import { ensureSessionRestored } from "../sessionBootstrap.js";

export function createSmartSyncHandlers() {
  return {
    [ACTION_START_SMART_SYNC](message, _sender, sendResponse) {
      const tabId = message.tabId;
      if (!Number.isInteger(tabId)) {
        sendResponse({ success: false, error: plaudT("bg.badTabId") });
        return false;
      }

      (async () => {
        await ensureSessionRestored();
        try {
          sendResponse(
            await startSmartSync(
              tabId,
              message.syncSubdirectory,
              message.syncMode
            )
          );
        } catch (error) {
          console.warn("Failed to start smart sync:", error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    },

    [ACTION_SMART_SYNC_PROGRESS](message, sender, sendResponse) {
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
    },

    [ACTION_SMART_SYNC_COMPLETE](message, sender, sendResponse) {
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
    },

    [ACTION_GET_SMART_SYNC_STATUS](message, _sender, sendResponse) {
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
    },
  };
}
