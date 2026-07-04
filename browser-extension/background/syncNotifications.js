import { loadSyncIndex } from "../common/storageUtils.js";
import {
  setSyncNotificationsEnabledFromSettings,
  syncNotificationsEnabled,
} from "../common/syncNotificationGate.js";

export { syncNotificationsEnabled } from "../common/syncNotificationGate.js";

/**
 * Loads sync-index settings and caches whether Chrome notifications are allowed.
 *
 * @returns {Promise<boolean>}
 */
export async function refreshSyncNotificationSetting() {
  try {
    const index = await loadSyncIndex();
    setSyncNotificationsEnabledFromSettings(index.settings);
  } catch {
    setSyncNotificationsEnabledFromSettings(undefined);
  }
  return syncNotificationsEnabled();
}

/**
 * @param {object} options
 */
export function createSyncNotification(options) {
  if (!syncNotificationsEnabled()) return;
  chrome.notifications.create(options);
}
