import { resolveSyncNotificationsEnabled } from "./syncCore.js";

/** @type {boolean | null} */
let enabledCache = null;

/** @param {{ syncNotificationsEnabled?: boolean } | null | undefined} settings */
export function setSyncNotificationsEnabledFromSettings(settings) {
  enabledCache = resolveSyncNotificationsEnabled(settings);
}

/** @returns {boolean} */
export function syncNotificationsEnabled() {
  return enabledCache !== false;
}

/** @param {boolean | null} value */
export function __setSyncNotificationsCacheForTests(value) {
  enabledCache = value;
}
