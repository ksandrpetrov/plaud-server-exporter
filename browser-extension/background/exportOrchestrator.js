import {
  getExportModeLabel as resolveExportModeLabel,
  normalizeExportMode,
} from "../common/exportPathUtils.js";
import { plaudT } from "./bgLocale.js";
import { sendTabMessage, sendTabMessageWithRecovery } from "./tabMessaging.js";
import { createSyncNotification } from "./syncNotifications.js";
import {
  ACTION_PLAUD_EXPORT_PING,
  ACTION_RUN_EXPORT_ALL,
} from "../common/runtimeMessages.js";
import {
  activeExports,
  activeTabIds,
  clearStallNotifyState,
  persistExportStateToSession,
  stallNotifySentForLastUpdate,
  stopFlags,
} from "./exportStateStore.js";

/** One keep-alive timeout chain per tab (avoid duplicates after session restore + start). */
const keepAliveChainStarted = new Set();

/**
 * @param {number} tabId
 * @returns {boolean} false when a chain is already active for this tab
 */
export function tryStartKeepAliveChain(tabId) {
  if (keepAliveChainStarted.has(tabId)) return false;
  keepAliveChainStarted.add(tabId);
  return true;
}

/** @param {number} tabId */
export function dropKeepAliveChain(tabId) {
  keepAliveChainStarted.delete(tabId);
}

/** Visible for unit tests only. */
export function _resetKeepAliveChainsForTests() {
  keepAliveChainStarted.clear();
}

export async function verifyExportTabAlive(tabId) {
  try {
    const pong = await sendTabMessage(tabId, {
      action: ACTION_PLAUD_EXPORT_PING,
    });
    return !!(pong && pong.alive);
  } catch {
    return false;
  }
}

export function getExportModeLabel(mode, { style = "short" } = {}) {
  return resolveExportModeLabel(mode, plaudT, {
    style: /** @type {"inline"|"short"} */ (style),
  });
}

function sendRunExportMessageWithRecovery(tabId, exportMode) {
  return sendTabMessageWithRecovery(tabId, {
    action: ACTION_RUN_EXPORT_ALL,
    background: true,
    exportMode,
  });
}

/**
 * @param {number} tabId
 * @param {string} requestedExportMode
 * @param {{
 *   sendRunExportMessageWithRecovery?: typeof sendRunExportMessageWithRecovery;
 *   persistExportStateToSession?: typeof persistExportStateToSession;
 *   createSyncNotification?: typeof createSyncNotification;
 *   keepTabAlive?: typeof keepTabAlive;
 * }} [_deps]
 */
export async function startBackgroundExport(
  tabId,
  requestedExportMode,
  _deps = {}
) {
  const deps = {
    sendRunExportMessageWithRecovery,
    persistExportStateToSession,
    createSyncNotification,
    keepTabAlive,
    ..._deps,
  };
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
    const response = await deps.sendRunExportMessageWithRecovery(
      tabId,
      exportMode
    );
    if (!response?.success) {
      throw new Error(response?.error || plaudT("bg.exportRejected"));
    }
  } catch (error) {
    activeTabIds.delete(tabId);
    stopFlags.delete(tabId);
    delete activeExports[tabId];
    clearStallNotifyState(tabId);
    deps.persistExportStateToSession();
    throw error;
  }

  deps.persistExportStateToSession();

  deps.createSyncNotification({
    type: "basic",
    iconUrl: "assets/icons/icon128.png",
    title: plaudT("bg.startedTitle", { mode: getExportModeLabel(exportMode) }),
    message: plaudT("bg.startedMessage"),
    priority: 2,
  });

  deps.keepTabAlive(tabId);
  return { success: true, message: plaudT("bg.startedSuccess") };
}

/**
 * @param {number} tabId
 * @param {boolean} [fromChain]
 */
export async function keepTabAlive(tabId, fromChain = false) {
  if (!fromChain) {
    if (!tryStartKeepAliveChain(tabId)) return;
  }
  try {
    if (!activeTabIds.has(tabId)) {
      keepAliveChainStarted.delete(tabId);
      return;
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      keepAliveChainStarted.delete(tabId);
      activeTabIds.delete(tabId);
      stopFlags.delete(tabId);
      delete activeExports[tabId];
      persistExportStateToSession();
      return;
    }

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
          createSyncNotification({
            type: "basic",
            iconUrl: "assets/icons/icon128.png",
            title: plaudT("bg.stallTitle"),
            message: plaudT("bg.stallMessage", { tabId: tabId }),
            priority: 2,
          });
        }
      }
    }

    setTimeout(() => keepTabAlive(tabId, true), 30000);
  } catch (error) {
    console.error(`keepTabAlive: Error for tab ${tabId}:`, error);
    keepAliveChainStarted.delete(tabId);
    activeTabIds.delete(tabId);
    stopFlags.delete(tabId);
    delete activeExports[tabId];
    clearStallNotifyState(tabId);
    persistExportStateToSession();
  }
}
