import { DEFAULT_SYNC_SUBDIRECTORY } from "../../common/exportPathUtils.js";
import { loadSyncIndex, patchSyncSettings } from "../../common/storageUtils.js";
import { sanitizeSyncSubdirectory } from "../../common/syncCore.js";
import {
  ACTION_GET_SYNC_SETTINGS,
  ACTION_SET_SYNC_MODE,
  ACTION_SET_SYNC_SUBDIRECTORY,
  ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER,
} from "../../common/runtimeMessages.js";
import { refreshSyncNotificationSetting } from "../syncNotifications.js";
import { summarizeSyncIndex } from "../smartSyncOrchestrator.js";

export function createSettingsHandlers() {
  return {
    [ACTION_GET_SYNC_SETTINGS](_message, _sender, sendResponse) {
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
    },

    [ACTION_SET_SYNC_SUBDIRECTORY](message, _sender, sendResponse) {
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
    },

    [ACTION_SET_SYNC_MODE](message, _sender, sendResponse) {
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
    },

    [ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER](_message, _sender, sendResponse) {
      if (typeof chrome.downloads?.showDefaultFolder !== "function") {
        sendResponse({
          success: false,
          error: "chrome.downloads недоступен в Safari.",
        });
        return false;
      }
      try {
        chrome.downloads.showDefaultFolder();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return false;
    },
  };
}
