import { ActionGuard } from "./actionGuard.js";

/** Shared guard for manual and scheduled Telegram sync (quiet sync has no guard). */
export const syncRunGuard = new ActionGuard({ cooldownSec: 35 });

/** Manual «🔄» tap — independent cooldown from scheduled runs (Чайка: plan:today vs plan:tomorrow). */
export const SYNC_ACTION_MANUAL = "sync:manual";
export const SYNC_ACTION_SCHEDULED = "sync:scheduled";

/**
 * @param {"manual" | "scheduled"} source
 * @returns {string}
 */
export function syncActionKey(source) {
  return source === "scheduled" ? SYNC_ACTION_SCHEDULED : SYNC_ACTION_MANUAL;
}
