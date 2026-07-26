import { STALE_RUNNING_EXPORT_MS } from "./exportStateStore.js";

export const SMART_SYNC_SESSION_KEY = "plaudSmartSyncV1";

/** @type {Record<number, Record<string, any>>} */
export let activeSmartSyncs = {};
export const activeSmartSyncTabIds = new Set();

export function resetSmartSyncState() {
  activeSmartSyncs = {};
  activeSmartSyncTabIds.clear();
}

export function persistSmartSyncStateToSession() {
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

/**
 * @param {() => void} done
 */
export function restoreSmartSyncStateFromSession(done) {
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
    const pack =
      /** @type {{ v?: number; activeSmartSyncs?: Record<string, Record<string, any>> } | undefined} */ (
        result[SMART_SYNC_SESSION_KEY]
      );
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
