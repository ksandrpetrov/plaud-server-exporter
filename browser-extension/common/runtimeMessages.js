/**
 * `chrome.runtime` / `chrome.tabs` message action constants.
 *
 * Single source of truth for the wire protocol between the three contexts:
 *
 *   popup.js  <—runtime—>  background.js (SW)  <—tabs—>  content.js + audioExport.js
 *
 * Action strings live here so the SW barrel, audioExport, and tests can
 * import them. popup.js and content.js are classic scripts (loaded via
 * `<script>` and the content_scripts manifest entry) and currently keep
 * string literals; `tests/runtimeMessages.test.js` verifies that every value
 * in this registry is referenced verbatim in those files, so renaming a
 * constant breaks the test instead of silently breaking the protocol.
 *
 * Conventions:
 *   - One key per action.
 *   - Values are plain ASCII identifiers.
 *   - Sender / handler are documented per-key (see comments below).
 *   - Adding a new action: add the constant here AND wire it into the
 *     sender + handler in the same PR.
 */

/** popup -> background (runtime.sendMessage) */
export const ACTION_START_BACKGROUND_EXPORT = "startBackgroundExport";
/** popup -> background */
export const ACTION_START_SMART_SYNC = "startSmartSync";
/** popup -> background */
export const ACTION_STOP_EXPORT = "stopExport";
/** popup -> background */
export const ACTION_GET_EXPORT_STATUS = "getExportStatus";
/** popup -> background */
export const ACTION_GET_ANY_RUNNING_EXPORT = "getAnyRunningExport";
/** popup -> background */
export const ACTION_GET_SMART_SYNC_STATUS = "getSmartSyncStatus";
/** popup -> background */
export const ACTION_GET_SYNC_SETTINGS = "getSyncSettings";
/** popup -> background */
export const ACTION_SET_SYNC_SUBDIRECTORY = "setSyncSubdirectory";
/** popup -> background */
export const ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER =
  "showDefaultDownloadsFolder";

/** content (audioExport) -> background (download a Plaud file via chrome.downloads) */
export const ACTION_DOWNLOAD_PLAUD_FILE = "downloadPlaudFile";

/** background -> content (tabs.sendMessage). Also popup -> content. */
export const ACTION_RUN_EXPORT_ALL = "runExportAll";
/** popup -> content */
export const ACTION_RUN_EXPORT_CURRENT_PAGE = "runExportCurrentPage";
/** popup -> content */
export const ACTION_RUN_LIBRARY_STATS = "runLibraryStats";
/** background -> content */
export const ACTION_RUN_SMART_SYNC = "runSmartSync";
/** background -> content (liveness probe) */
export const ACTION_PLAUD_EXPORT_PING = "plaudExportPing";
/** background -> content (cooperative cancel) */
export const ACTION_STOP_EXPORT_PROCESS = "stopExportProcess";
/** content (audioExport poll) -> background (should I stop?) */
export const ACTION_CHECK_SHOULD_STOP = "checkShouldStop";

/** content -> background (DOM-only export finished) */
export const ACTION_EXPORT_COMPLETE = "exportComplete";
/** content -> background (foreground export finished) */
export const ACTION_FOREGROUND_EXPORT_COMPLETE = "foregroundExportComplete";
/** content -> background (library stats stream) */
export const ACTION_LIBRARY_STATS_PROGRESS = "libraryStatsProgress";
/** content -> background (smart sync per-file progress) */
export const ACTION_SMART_SYNC_PROGRESS = "smartSyncProgress";
/** content -> background (smart sync finished) */
export const ACTION_SMART_SYNC_COMPLETE = "smartSyncComplete";
/** content (audioExport) -> background (export per-file progress) */
export const ACTION_EXPORT_PROGRESS_UPDATE = "exportProgressUpdate";

/** background -> popup (broadcast smart-sync state changes) */
export const ACTION_SMART_SYNC_STATUS_UPDATE = "smartSyncStatusUpdate";

/**
 * Frozen map of all known action values. Used by `runtimeMessages.test.js`
 * to assert that classic-script files (`popup.js`, `content.js`) still
 * reference these exact strings.
 */
export const RUNTIME_MESSAGE_ACTIONS = Object.freeze({
  ACTION_START_BACKGROUND_EXPORT,
  ACTION_START_SMART_SYNC,
  ACTION_STOP_EXPORT,
  ACTION_GET_EXPORT_STATUS,
  ACTION_GET_ANY_RUNNING_EXPORT,
  ACTION_GET_SMART_SYNC_STATUS,
  ACTION_GET_SYNC_SETTINGS,
  ACTION_SET_SYNC_SUBDIRECTORY,
  ACTION_SHOW_DEFAULT_DOWNLOADS_FOLDER,
  ACTION_DOWNLOAD_PLAUD_FILE,
  ACTION_RUN_EXPORT_ALL,
  ACTION_RUN_EXPORT_CURRENT_PAGE,
  ACTION_RUN_LIBRARY_STATS,
  ACTION_RUN_SMART_SYNC,
  ACTION_PLAUD_EXPORT_PING,
  ACTION_STOP_EXPORT_PROCESS,
  ACTION_CHECK_SHOULD_STOP,
  ACTION_EXPORT_COMPLETE,
  ACTION_FOREGROUND_EXPORT_COMPLETE,
  ACTION_LIBRARY_STATS_PROGRESS,
  ACTION_SMART_SYNC_PROGRESS,
  ACTION_SMART_SYNC_COMPLETE,
  ACTION_EXPORT_PROGRESS_UPDATE,
  ACTION_SMART_SYNC_STATUS_UPDATE,
});
