export const EXPORT_SESSION_KEY = "plaudBgExportV1";
export const STALE_RUNNING_EXPORT_MS = 1000 * 60 * 60 * 24;
export const PING_STALE_AFTER_MS = 1000 * 180;

/** @type {Record<number, object>} */
export let activeExports = {};
export const activeTabIds = new Set();
export const stopFlags = new Set();

/** tabId -> export lastUpdateTime when stall notification was last shown (dedupe ~30s ticks). */
export const stallNotifySentForLastUpdate = Object.create(null);

export function clearStallNotifyState(tabId) {
  if (tabId == null || !Number.isInteger(tabId)) return;
  delete stallNotifySentForLastUpdate[tabId];
}

export function resetExportState() {
  activeExports = {};
  activeTabIds.clear();
  stopFlags.clear();
  for (const k of Object.keys(stallNotifySentForLastUpdate)) {
    delete stallNotifySentForLastUpdate[k];
  }
}

export function persistExportStateToSession() {
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

/**
 * @param {() => void} done
 */
export function restoreExportStateFromSession(done) {
  if (!chrome.storage?.session?.get) {
    if (done) done();
    return;
  }
  chrome.storage.session.get([EXPORT_SESSION_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.warn("restoreExportStateFromSession:", chrome.runtime.lastError);
      if (done) done();
      return;
    }
    const pack =
      /** @type {{ v?: number; activeExports?: Record<string, object>; stopFlagTabIds?: number[] } | undefined} */ (
        result[EXPORT_SESSION_KEY]
      );
    if (!pack || pack.v !== 1 || !pack.activeExports) {
      if (done) done();
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
    if (done) done();
  });
}
