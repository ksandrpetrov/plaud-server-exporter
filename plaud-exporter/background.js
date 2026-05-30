// background.js - Service Worker for Audio Export Extension (ES module)

import "./common/plaud-i18n-messages.js";
import {
  AUDIO_SUBDIRECTORY,
  DEFAULT_SYNC_SUBDIRECTORY,
  EXPORT_MODE_AUDIO,
  EXPORT_MODE_SUMMARY,
  normalizeExportMode,
} from "./common/exportPathUtils.js";
import {
  attachLocaleChangeListener,
  plaudT,
  syncPlaudLocale,
} from "./background/bgLocale.js";
import {
  sendTabMessage,
  sendTabMessageWithRecovery,
} from "./background/tabMessaging.js";
import { downloadPlaudFile } from "./background/chromeDownloadBridge.js";
import { loadSyncIndex, patchSyncSettings } from "./common/storageUtils.js";
import { sanitizeSyncSubdirectory } from "./common/syncCore.js";
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
  ACTION_PLAUD_EXPORT_PING,
  ACTION_RUN_EXPORT_ALL,
  ACTION_RUN_SMART_SYNC,
  ACTION_SET_SYNC_SUBDIRECTORY,
  ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER,
  ACTION_SMART_SYNC_COMPLETE,
  ACTION_SMART_SYNC_PROGRESS,
  ACTION_SMART_SYNC_STATUS_UPDATE,
  ACTION_START_BACKGROUND_EXPORT,
  ACTION_START_SMART_SYNC,
  ACTION_STOP_EXPORT,
  ACTION_STOP_EXPORT_PROCESS,
} from "./common/runtimeMessages.js";

function plaudBgLog(...args) {
  if (globalThis.plaudExporterBgDebug === true) {
    console.log(...args);
  }
}

syncPlaudLocale();
attachLocaleChangeListener();

/**
 * Global variables to track export state:
 * - activeExports: Object mapping tab IDs to their export status and statistics.
 * - activeTabIds: Set of tab IDs currently engaged in export.
 * - stopFlags: Set of tab IDs where an export stop was requested.
 */
let activeExports = {};
let activeTabIds = new Set();
let stopFlags = new Set();
let activeSmartSyncs = {};
let activeSmartSyncTabIds = new Set();

const EXPORT_SESSION_KEY = "plaudBgExportV1";
const SMART_SYNC_SESSION_KEY = "plaudSmartSyncV1";
const STALE_RUNNING_EXPORT_MS = 1000 * 60 * 60 * 24;
const PING_STALE_AFTER_MS = 1000 * 180;

/** tabId -> export lastUpdateTime when stall notification was last shown (dedupe ~30s ticks). */
const stallNotifySentForLastUpdate = Object.create(null);

function clearStallNotifyState(tabId) {
  if (tabId == null || !Number.isInteger(tabId)) return;
  delete stallNotifySentForLastUpdate[tabId];
}

let sessionRestorePromise = null;

function ensureSessionRestored() {
  if (!sessionRestorePromise) {
    sessionRestorePromise = new Promise((resolve) => {
      restoreExportStateFromSession(resolve);
    });
  }
  return sessionRestorePromise;
}

function persistExportStateToSession() {
  if (!chrome.storage?.session?.set) return;
  try {
    chrome.storage.session.set({
      [EXPORT_SESSION_KEY]: {
        v: 1,
        activeExports: { ...activeExports },
        stopFlagTabIds: [...stopFlags],
        savedAt: Date.now(),
      },
    });
  } catch (error) {
    console.warn("persistExportStateToSession:", error);
  }
}

function persistSmartSyncStateToSession() {
  if (!chrome.storage?.session?.set) return;
  try {
    chrome.storage.session.set({
      [SMART_SYNC_SESSION_KEY]: {
        v: 1,
        activeSmartSyncs: { ...activeSmartSyncs },
        activeTabIds: [...activeSmartSyncTabIds],
        savedAt: Date.now(),
      },
    });
  } catch (error) {
    console.warn("persistSmartSyncStateToSession:", error);
  }
}

function restoreExportStateFromSession(done) {
  if (!chrome.storage?.session?.get) {
    if (done) done();
    return;
  }
  chrome.storage.session.get([EXPORT_SESSION_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.warn("restoreExportStateFromSession:", chrome.runtime.lastError);
      restoreSmartSyncStateFromSession(done);
      return;
    }
    const pack = result[EXPORT_SESSION_KEY];
    if (!pack || pack.v !== 1 || !pack.activeExports) {
      restoreSmartSyncStateFromSession(done);
      return;
    }
    const now = Date.now();
    activeExports = {};
    activeTabIds.clear();
    stopFlags.clear();
    for (const [k, entry] of Object.entries(pack.activeExports)) {
      const tabId = Number(k);
      if (!Number.isInteger(tabId) || !entry || typeof entry !== "object")
        continue;
      if (entry.status === "running") {
        const last =
          Number(entry.lastUpdateTime) || Number(entry.startTime) || 0;
        if (last && now - last > STALE_RUNNING_EXPORT_MS) continue;
      }
      activeExports[tabId] = entry;
      if (entry.status === "running") activeTabIds.add(tabId);
    }
    for (const id of pack.stopFlagTabIds || []) {
      if (Number.isInteger(id)) stopFlags.add(id);
    }
    for (const tabId of activeTabIds) {
      keepTabAlive(tabId);
    }
    restoreSmartSyncStateFromSession(done);
  });
}

function restoreSmartSyncStateFromSession(done) {
  if (!chrome.storage?.session?.get) {
    if (done) done();
    return;
  }
  chrome.storage.session.get([SMART_SYNC_SESSION_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.warn(
        "restoreSmartSyncStateFromSession:",
        chrome.runtime.lastError
      );
      if (done) done();
      return;
    }
    const pack = result[SMART_SYNC_SESSION_KEY];
    activeSmartSyncs = {};
    activeSmartSyncTabIds.clear();
    if (pack?.v === 1 && pack.activeSmartSyncs) {
      const now = Date.now();
      for (const [k, entry] of Object.entries(pack.activeSmartSyncs)) {
        const tabId = Number(k);
        if (!Number.isInteger(tabId) || !entry || typeof entry !== "object") {
          continue;
        }
        if (entry.status === "running") {
          const last =
            Number(entry.lastUpdateTime) || Number(entry.startedAt) || 0;
          if (last && now - last > STALE_RUNNING_EXPORT_MS) continue;
          activeSmartSyncTabIds.add(tabId);
        }
        activeSmartSyncs[tabId] = entry;
      }
    }
    if (done) done();
  });
}

async function verifyExportTabAlive(tabId) {
  try {
    const pong = await sendTabMessage(tabId, {
      action: ACTION_PLAUD_EXPORT_PING,
    });
    return !!(pong && pong.alive);
  } catch {
    return false;
  }
}

/**
 * Listener for incoming messages from content scripts and the popup.
 * Handles different actions such as stopping exports, starting background exports,
 * updating progress, and providing export status.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  plaudBgLog("Background received message:", message.action);

  try {
    // Handle stop export request from popup or content script
    if (message.action === ACTION_STOP_EXPORT) {
      const tabId = message.tabId;
      if (activeTabIds.has(tabId)) {
        // Mark the export as stopped and remove from active tracking
        stopFlags.add(tabId);
        activeTabIds.delete(tabId);

        if (activeExports[tabId]) {
          activeExports[tabId].status = "stopped";
        }
        persistExportStateToSession();
        clearStallNotifyState(tabId);

        // Attempt to notify the content script to stop the export process
        sendTabMessage(tabId, { action: ACTION_STOP_EXPORT_PROCESS }).catch(
          (error) => console.warn("Failed to send stop message:", error)
        );

        // Notify the user via Chrome notifications about the stopped export
        chrome.notifications.create({
          type: "basic",
          iconUrl: "assets/icons/icon128.png", // Use relative path from manifest
          title: plaudT("bg.stopTitle"),
          message: plaudT("bg.stopMessage"),
          priority: 1,
        });
      }

      // Respond immediately indicating success
      sendResponse({ success: true });
      return false; // Indicates synchronous response
    }

    // Check if the export process for the sender's tab should be stopped
    if (message.action === ACTION_CHECK_SHOULD_STOP) {
      const tabId = sender.tab?.id;
      const shouldStop = stopFlags.has(tabId);
      sendResponse({ shouldStop });
      return false; // Synchronous response
    }

    // Start a new background export process
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

      startSmartSync(tabId, message.syncSubdirectory)
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
        chrome.notifications.create({
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

    if (message.action === ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER) {
      try {
        chrome.downloads.showDefaultFolder();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return false;
    }

    // Update export progress from the content script
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

        // Merge new progress data with existing export stats
        activeExports[tabId] = {
          ...activeExports[tabId],
          ...progressData,
          lastUpdateTime: Date.now(),
          lastNotifiedProcessed: previousNotified,
        };

        // Issue periodic notifications for every 10 files processed
        if (
          processed % 10 === 0 &&
          processed > 0 &&
          processed !== previousNotified
        ) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "assets/icons/icon128.png", // Use relative path from manifest
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
      return false; // Synchronous response
    }

    // Handle export completion
    if (message.action === ACTION_EXPORT_COMPLETE) {
      const tabId = sender.tab?.id;

      if (tabId && activeExports[tabId]) {
        const stats = message.data || {};
        const processed = Number(stats.filesProcessed) || 0;
        const errored = Number(stats.filesErrored) || 0;
        // Update status before notification
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

        // Notify the user of export completion with statistics
        chrome.notifications.create({
          type: "basic",
          iconUrl: "assets/icons/icon128.png", // Use relative path from manifest
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

        // Schedule removal of export data after 1 minute
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
      return false; // Synchronous response
    }

    if (message.action === ACTION_FOREGROUND_EXPORT_COMPLETE) {
      plaudBgLog("foregroundExportComplete tab", message.tabId);
      chrome.runtime
        .sendMessage({
          action: ACTION_FOREGROUND_EXPORT_COMPLETE,
          tabId: message.tabId,
        })
        .catch(() => {});
      sendResponse({ success: true });
      return false;
    }

    // Provide the current export status for a given tab
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

    // Library stats progress: content script → service worker only (MV3).
    // Retransmit so popup.js can update the gamified stats UI.
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

    // Download a file URL discovered by the content script.
    if (message.action === ACTION_DOWNLOAD_PLAUD_FILE) {
      downloadPlaudFile(message)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error("Failed to download Plaud file:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep the message channel open for the async download.
    }

    // Default case: Unrecognized message action
    console.warn("Unrecognized message action received:", message.action);
    sendResponse({ success: false, error: plaudT("bg.unknownAction") });
    return false; // Synchronous response
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, error: error.message });
    return false; // Synchronous response
  }
});

function getExportModeLabel(mode) {
  if (mode === EXPORT_MODE_AUDIO) return plaudT("exportMode.shortAudio");
  if (mode === EXPORT_MODE_SUMMARY) return plaudT("exportMode.shortSummary");
  return plaudT("exportMode.shortBoth");
}

function sendRunExportMessageWithRecovery(tabId, exportMode) {
  return sendTabMessageWithRecovery(tabId, {
    action: ACTION_RUN_EXPORT_ALL,
    background: true,
    exportMode,
  });
}

function sendRunSmartSyncMessageWithRecovery(tabId, syncSubdirectory) {
  return sendTabMessageWithRecovery(tabId, {
    action: ACTION_RUN_SMART_SYNC,
    syncSubdirectory: sanitizeSyncSubdirectory(syncSubdirectory),
  });
}

function summarizeSyncIndex(index) {
  const records = Object.values(index?.records || {});
  const lastSyncedAt = records
    .map((record) => record?.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    records: records.length,
    lastSyncedAt: lastSyncedAt || "",
  };
}

async function startBackgroundExport(tabId, requestedExportMode) {
  await ensureSessionRestored();
  if (activeTabIds.has(tabId) && activeExports[tabId]?.status === "running") {
    throw new Error(plaudT("bg.exportAlreadyRunning"));
  }

  const exportMode = normalizeExportMode(requestedExportMode);
  activeTabIds.add(tabId);
  stopFlags.delete(tabId);

  activeExports[tabId] = {
    status: "running",
    exportMode,
    filesProcessed: 0,
    filesSkipped: 0,
    filesErrored: 0,
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
    lastNotifiedProcessed: 0,
  };

  try {
    const response = await sendRunExportMessageWithRecovery(tabId, exportMode);
    if (!response?.success) {
      throw new Error(response?.error || plaudT("bg.exportRejected"));
    }
  } catch (error) {
    activeTabIds.delete(tabId);
    stopFlags.delete(tabId);
    delete activeExports[tabId];
    clearStallNotifyState(tabId);
    persistExportStateToSession();
    throw error;
  }

  persistExportStateToSession();

  chrome.notifications.create({
    type: "basic",
    iconUrl: "assets/icons/icon128.png",
    title: plaudT("bg.startedTitle", { mode: getExportModeLabel(exportMode) }),
    message: plaudT("bg.startedMessage"),
    priority: 2,
  });

  keepTabAlive(tabId);
  return { success: true, message: plaudT("bg.startedSuccess") };
}

async function startSmartSync(tabId, requestedSubdirectory) {
  await ensureSessionRestored();
  if (
    activeSmartSyncTabIds.has(tabId) &&
    activeSmartSyncs[tabId]?.status === "running"
  ) {
    throw new Error(plaudT("sync.alreadyRunning"));
  }

  const syncSubdirectory = sanitizeSyncSubdirectory(requestedSubdirectory);
  activeSmartSyncTabIds.add(tabId);
  activeSmartSyncs[tabId] = {
    status: "running",
    total: 0,
    processed: 0,
    new: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    startedAt: Date.now(),
    lastUpdateTime: Date.now(),
    syncSubdirectory,
  };
  persistSmartSyncStateToSession();

  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && chrome.tabs.update && typeof tab.autoDiscardable === "boolean") {
      await chrome.tabs
        .update(tabId, { autoDiscardable: false })
        .catch(() => {});
    }
    const response = await sendRunSmartSyncMessageWithRecovery(
      tabId,
      syncSubdirectory
    );
    if (!response?.success) {
      throw new Error(response?.error || plaudT("sync.rejected"));
    }
  } catch (error) {
    activeSmartSyncTabIds.delete(tabId);
    activeSmartSyncs[tabId] = {
      ...(activeSmartSyncs[tabId] || {}),
      status: "error",
      error: error.message,
      finishedAt: Date.now(),
      lastUpdateTime: Date.now(),
    };
    persistSmartSyncStateToSession();
    throw error;
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "assets/icons/icon128.png",
    title: plaudT("sync.notifyStartedTitle"),
    message: plaudT("sync.notifyStartedMessage", { folder: syncSubdirectory }),
    priority: 1,
  });

  return { success: true, message: plaudT("sync.started") };
}

/** One keep-alive timeout chain per tab (avoid duplicates after session restore + start). */
const keepAliveChainStarted = new Set();

/**
 * keepTabAlive - Recursively ensures that a tab remains active during background exports.
 * Prevents the browser from suspending the tab when it's not visible and checks for stalled exports.
 *
 * @param {number} tabId - The ID of the tab to keep alive.
 * @param {boolean} fromChain - internal: true for scheduled follow-up ticks
 */
async function keepTabAlive(tabId, fromChain = false) {
  if (!fromChain) {
    if (keepAliveChainStarted.has(tabId)) return;
    keepAliveChainStarted.add(tabId);
  }
  try {
    // Check if the export for this tab is still marked as active
    if (!activeTabIds.has(tabId)) {
      keepAliveChainStarted.delete(tabId);
      plaudBgLog(
        `keepTabAlive: Export for tab ${tabId} is no longer active. Stopping.`
      );
      return;
    }

    // Verify the tab still exists
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      plaudBgLog(`keepTabAlive: Tab ${tabId} not found. Cleaning up.`);
      keepAliveChainStarted.delete(tabId);
      activeTabIds.delete(tabId);
      stopFlags.delete(tabId);
      delete activeExports[tabId]; // Clean up associated export data
      persistExportStateToSession();
      return;
    }

    // Prevent the tab from being auto-discarded (if supported)
    if (chrome.tabs.update && typeof tab.autoDiscardable === "boolean") {
      await chrome.tabs
        .update(tabId, { autoDiscardable: false })
        .catch((err) =>
          console.warn(
            `keepTabAlive: Failed to set autoDiscardable for tab ${tabId}:`,
            err
          )
        );
    }

    // Check if export progress has stalled (no update for 2 minutes)
    const exportData = activeExports[tabId];
    if (exportData && exportData.status === "running") {
      const timeSinceLastUpdate = Date.now() - exportData.lastUpdateTime;
      if (timeSinceLastUpdate > 120000) {
        const frozenAt = Number(exportData.lastUpdateTime) || 0;
        if (stallNotifySentForLastUpdate[tabId] !== frozenAt) {
          stallNotifySentForLastUpdate[tabId] = frozenAt;
          console.warn(
            `keepTabAlive: Export for tab ${tabId} might be stalled. Last update ${Math.round(
              timeSinceLastUpdate / 1000
            )}s ago.`
          );
          chrome.notifications.create({
            type: "basic",
            iconUrl: "assets/icons/icon128.png", // Use relative path from manifest
            title: plaudT("bg.stallTitle"),
            message: plaudT("bg.stallMessage", { tabId: tabId }),
            priority: 2,
          });
        }
      }
    }

    // Schedule the next keep-alive check in 30 seconds
    plaudBgLog(`keepTabAlive: Scheduling next check for tab ${tabId} in 30s.`);
    setTimeout(() => keepTabAlive(tabId, true), 30000);
  } catch (error) {
    console.error(`keepTabAlive: Error for tab ${tabId}:`, error);
    keepAliveChainStarted.delete(tabId);
    // Clean up on error to prevent infinite loops or resource leaks
    activeTabIds.delete(tabId);
    stopFlags.delete(tabId);
    delete activeExports[tabId];
    clearStallNotifyState(tabId);
    persistExportStateToSession();
  }
}

ensureSessionRestored();

chrome.runtime.onInstalled.addListener((details) => {
  plaudBgLog("Extension installed or updated:", details.reason);
  sessionRestorePromise = null;
  if (details.reason === "install" && chrome.storage?.session?.remove) {
    chrome.storage.session.remove(
      [EXPORT_SESSION_KEY, SMART_SYNC_SESSION_KEY],
      () => {
        activeExports = {};
        activeTabIds.clear();
        stopFlags.clear();
        activeSmartSyncs = {};
        activeSmartSyncTabIds.clear();
        for (const k of Object.keys(stallNotifySentForLastUpdate)) {
          delete stallNotifySentForLastUpdate[k];
        }
      }
    );
    return;
  }
  ensureSessionRestored();
});

// Monitor tab closure to clean up exports for tabs that are removed
chrome.tabs.onRemoved.addListener((tabId, _removeInfo) => {
  if (activeTabIds.has(tabId)) {
    plaudBgLog(`Tab ${tabId} with active export was closed. Cleaning up.`);
    keepAliveChainStarted.delete(tabId);
    activeTabIds.delete(tabId);
    stopFlags.delete(tabId);
    delete activeExports[tabId];
    clearStallNotifyState(tabId);
    persistExportStateToSession();
    // Optionally notify the user that closing the tab stopped the export
    chrome.notifications.create({
      type: "basic",
      iconUrl: "assets/icons/icon128.png",
      title: plaudT("bg.tabClosedTitle"),
      message: plaudT("bg.tabClosedMessage"),
      priority: 1,
    });
  }
  if (activeSmartSyncTabIds.has(tabId)) {
    activeSmartSyncTabIds.delete(tabId);
    activeSmartSyncs[tabId] = {
      ...(activeSmartSyncs[tabId] || {}),
      status: "error",
      error: plaudT("sync.tabClosedMessage"),
      finishedAt: Date.now(),
      lastUpdateTime: Date.now(),
    };
    persistSmartSyncStateToSession();
    chrome.notifications.create({
      type: "basic",
      iconUrl: "assets/icons/icon128.png",
      title: plaudT("sync.notifyErrorTitle"),
      message: plaudT("sync.tabClosedMessage"),
      priority: 1,
    });
  }
});

// --- NEW: Listener for determining download filename ---
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  plaudBgLog(
    "onDeterminingFilename event triggered for:",
    downloadItem.filename
  );

  // Check if the download originates from a tab where we are actively exporting
  const originatingTabId = downloadItem.tabId;
  if (originatingTabId && activeTabIds.has(originatingTabId)) {
    plaudBgLog(
      `Download from active export tab ${originatingTabId}. Filename: ${downloadItem.filename}`
    );

    // Basic check if it's likely the audio file we expect (e.g., MP3)
    // You might need more specific checks based on Plaud's naming patterns if possible
    if (
      downloadItem.filename &&
      downloadItem.filename.toLowerCase().endsWith(".mp3")
    ) {
      // Path under downloads: sanitized Audio subdirectory + filename
      const safeAudioDir = AUDIO_SUBDIRECTORY.replace(/[\\/:*?"<>|]/g, "_");
      const newFilename = `${safeAudioDir}/${downloadItem.filename}`;
      plaudBgLog(`Suggesting new filename: ${newFilename}`);

      suggest({
        filename: newFilename,
        conflictAction: "uniquify", // Options: 'uniquify', 'overwrite', 'prompt'
      });

      // Note: The 'suggest' function must be called synchronously within this event listener
      // if you are not returning true to indicate an asynchronous response.
      return; // Suggestion made, exit listener for this item
    } else {
      plaudBgLog(
        `Download from active tab ${originatingTabId}, but filename "${downloadItem.filename}" does not match expected pattern (.mp3). Allowing default.`
      );
    }
  } else {
    plaudBgLog(
      `Download filename "${
        downloadItem.filename
      }" did not originate from a tracked active export tab (${
        originatingTabId ? originatingTabId : "N/A"
      }). Allowing default.`
    );
  }

  // If the download doesn't meet the criteria, let the browser handle it normally.
  // No need to call suggest() here; simply returning lets the default behavior proceed.
});

plaudBgLog("Background script loaded and listeners initialized.");
