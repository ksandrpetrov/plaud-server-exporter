/**
 * Pure lock checks for content-script smart sync start.
 */

/**
 * @param {{ exportRunLock?: boolean; smartSyncLock?: boolean }} state
 * @returns {"sync.busy"|"sync.alreadyRunning"|null}
 */
export function smartSyncBusyErrorKey(state) {
  if (state.exportRunLock) return "sync.busy";
  if (state.smartSyncLock) return "sync.alreadyRunning";
  return null;
}
