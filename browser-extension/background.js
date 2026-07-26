// background.js - Service Worker for Audio Export Extension (ES module)

import "./common/plaud-i18n-messages.js";
import {
  attachLocaleChangeListener,
  plaudT,
  syncPlaudLocale,
} from "./background/bgLocale.js";
import { createSyncNotification } from "./background/syncNotifications.js";
import {
  EXPORT_SESSION_KEY,
  activeExports,
  activeTabIds,
  clearStallNotifyState,
  persistExportStateToSession,
  resetExportState,
  stopFlags,
} from "./background/exportStateStore.js";
import {
  SMART_SYNC_SESSION_KEY,
  activeSmartSyncs,
  activeSmartSyncTabIds,
  persistSmartSyncStateToSession,
  resetSmartSyncState,
} from "./background/smartSyncStateStore.js";
import { dropKeepAliveChain } from "./background/exportOrchestrator.js";
import {
  ensureSessionRestored,
  resetSessionRestorePromise,
} from "./background/sessionBootstrap.js";
import { registerMessageRouter } from "./background/messageRouter.js";

function plaudBgLog(...args) {
  if (globalThis.plaudExporterBgDebug === true) {
    console.log(...args);
  }
}

syncPlaudLocale();
attachLocaleChangeListener();
registerMessageRouter(plaudBgLog);
ensureSessionRestored();

chrome.runtime.onInstalled.addListener((details) => {
  plaudBgLog("Extension installed or updated:", details.reason);
  resetSessionRestorePromise();
  if (details.reason === "install" && chrome.storage?.session?.remove) {
    chrome.storage.session.remove(
      [EXPORT_SESSION_KEY, SMART_SYNC_SESSION_KEY],
      () => {
        resetExportState();
        resetSmartSyncState();
      }
    );
    return;
  }
  ensureSessionRestored();
});

chrome.tabs.onRemoved.addListener((tabId, _removeInfo) => {
  if (activeTabIds.has(tabId)) {
    plaudBgLog(`Tab ${tabId} with active export was closed. Cleaning up.`);
    dropKeepAliveChain(tabId);
    activeTabIds.delete(tabId);
    stopFlags.delete(tabId);
    delete activeExports[tabId];
    clearStallNotifyState(tabId);
    persistExportStateToSession();
    createSyncNotification({
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
    createSyncNotification({
      type: "basic",
      iconUrl: "assets/icons/icon128.png",
      title: plaudT("sync.notifyErrorTitle"),
      message: plaudT("sync.tabClosedMessage"),
      priority: 1,
    });
  }
});

plaudBgLog("Background script loaded and listeners initialized.");
