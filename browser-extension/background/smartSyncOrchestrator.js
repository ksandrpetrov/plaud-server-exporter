import { DEFAULT_SYNC_SUBDIRECTORY } from "../common/exportPathUtils.js";
import { sanitizeSyncSubdirectory } from "../common/syncCore.js";
import { patchSyncSettings } from "../common/storageUtils.js";
import { plaudT } from "./bgLocale.js";
import { sendTabMessageWithRecovery } from "./tabMessaging.js";
import { createSyncNotification } from "./syncNotifications.js";
import { ACTION_RUN_SMART_SYNC } from "../common/runtimeMessages.js";
import {
  activeSmartSyncs,
  activeSmartSyncTabIds,
  persistSmartSyncStateToSession,
} from "./smartSyncStateStore.js";

function sendRunSmartSyncMessageWithRecovery(
  tabId,
  syncSubdirectory,
  syncMode
) {
  return sendTabMessageWithRecovery(tabId, {
    action: ACTION_RUN_SMART_SYNC,
    syncSubdirectory: sanitizeSyncSubdirectory(syncSubdirectory),
    syncMode: syncMode === "summary" ? "summary" : "both",
  });
}

export function summarizeSyncIndex(index) {
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

/**
 * @param {number} tabId
 * @param {string | undefined} requestedSubdirectory
 * @param {string | undefined} requestedSyncMode
 * @param {{
 *   patchSyncSettings?: typeof patchSyncSettings;
 *   persistSmartSyncStateToSession?: typeof persistSmartSyncStateToSession;
 *   getTab?: (tabId: number) => Promise<chrome.tabs.Tab | null>;
 *   updateTab?: (tabId: number, patch: chrome.tabs.UpdateProperties) => Promise<unknown>;
 *   sendRunSmartSyncMessageWithRecovery?: typeof sendRunSmartSyncMessageWithRecovery;
 *   createSyncNotification?: typeof createSyncNotification;
 * }} [_deps]
 */
export async function startSmartSync(
  tabId,
  requestedSubdirectory,
  requestedSyncMode,
  _deps = {}
) {
  const deps = {
    patchSyncSettings,
    persistSmartSyncStateToSession,
    getTab: (id) => chrome.tabs.get(id).catch(() => null),
    updateTab: (id, patch) => chrome.tabs.update(id, patch).catch(() => {}),
    sendRunSmartSyncMessageWithRecovery,
    createSyncNotification,
    ..._deps,
  };
  if (
    activeSmartSyncTabIds.has(tabId) &&
    activeSmartSyncs[tabId]?.status === "running"
  ) {
    throw new Error(plaudT("sync.alreadyRunning"));
  }

  const syncSubdirectory = sanitizeSyncSubdirectory(
    requestedSubdirectory || DEFAULT_SYNC_SUBDIRECTORY
  );
  const syncMode = requestedSyncMode === "summary" ? "summary" : "both";
  await deps.patchSyncSettings({ syncSubdirectory, syncMode }).catch(() => {});
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
  deps.persistSmartSyncStateToSession();

  try {
    const tab = await deps.getTab(tabId);
    if (tab && typeof tab.autoDiscardable === "boolean") {
      await deps.updateTab(tabId, { autoDiscardable: false });
    }
    const response = await deps.sendRunSmartSyncMessageWithRecovery(
      tabId,
      syncSubdirectory,
      syncMode
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
    deps.persistSmartSyncStateToSession();
    throw error;
  }

  deps.createSyncNotification({
    type: "basic",
    iconUrl: "assets/icons/icon128.png",
    title: plaudT("sync.notifyStartedTitle"),
    message: plaudT("sync.notifyStartedMessage", { folder: syncSubdirectory }),
    priority: 1,
  });

  return { success: true, message: plaudT("sync.started") };
}
