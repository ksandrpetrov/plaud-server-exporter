import { refreshSyncNotificationSetting } from "./syncNotifications.js";
import {
  activeTabIds,
  restoreExportStateFromSession,
} from "./exportStateStore.js";
import { restoreSmartSyncStateFromSession } from "./smartSyncStateStore.js";
import { keepTabAlive } from "./exportOrchestrator.js";

let sessionRestorePromise = null;

export function ensureSessionRestored() {
  if (!sessionRestorePromise) {
    sessionRestorePromise = new Promise((resolve) => {
      restoreExportStateFromSession(() => {
        restoreSmartSyncStateFromSession(() => {
          for (const tabId of activeTabIds) {
            keepTabAlive(tabId);
          }
          refreshSyncNotificationSetting().finally(() => resolve());
        });
      });
    });
  }
  return sessionRestorePromise;
}

export function resetSessionRestorePromise() {
  sessionRestorePromise = null;
}
