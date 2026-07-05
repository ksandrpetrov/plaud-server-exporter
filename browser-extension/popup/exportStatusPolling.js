(function (global) {
  "use strict";

  global.PlaudPopup = global.PlaudPopup || {};

  const DEFAULT_STATUS_TIMEOUT_MS = 1200;
  const MAX_POLL_TRANSIENT_ERRORS = 4;

  /**
   * @param {{
   *   exportActive: boolean;
   *   currentExportTabId: number | null;
   *   focusedTab: { id?: number } | null;
   *   isPlaudTab: (tab: object) => boolean;
   * }} params
   * @returns {number | null}
   */
  global.PlaudPopup.resolveExportStatusTabId =
    function resolveExportStatusTabId(params) {
      const { exportActive, currentExportTabId, focusedTab, isPlaudTab } =
        params;
      if (exportActive && currentExportTabId != null) return currentExportTabId;
      if (focusedTab && isPlaudTab(focusedTab)) return focusedTab.id ?? null;
      return null;
    };

  /**
   * @param {object | null | undefined} anyResp
   * @returns {boolean}
   */
  global.PlaudPopup.shouldResumeFromAnyRunningExport =
    function shouldResumeFromAnyRunningExport(anyResp) {
      return Boolean(
        anyResp?.success && anyResp.isRunning && anyResp.tabId != null
      );
    };

  /**
   * @param {{
   *   onFinalize: (sendError: Error | null, response: object | null) => void;
   *   timeoutMs?: number;
   *   setTimer?: typeof setTimeout;
   *   clearTimer?: typeof clearTimeout;
   * }} params
   */
  global.PlaudPopup.createExportStatusFinalizer =
    function createExportStatusFinalizer(params) {
      const {
        onFinalize,
        timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
        setTimer = setTimeout,
        clearTimer = clearTimeout,
      } = params;
      let finalized = false;
      let timerId = null;

      function finalize(sendError, response) {
        if (finalized) return;
        finalized = true;
        if (timerId !== null) {
          clearTimer(timerId);
          timerId = null;
        }
        onFinalize(sendError, response);
      }

      timerId = setTimer(function () {
        finalize(new Error("getExportStatus timeout"), null);
      }, timeoutMs);

      return {
        finalize,
        cancel() {
          if (timerId !== null) {
            clearTimer(timerId);
            timerId = null;
          }
          finalized = true;
        },
      };
    };

  /**
   * @param {number} transientErrors
   * @returns {boolean}
   */
  global.PlaudPopup.shouldStopExportPollingAfterErrors =
    function shouldStopExportPollingAfterErrors(transientErrors) {
      return transientErrors >= MAX_POLL_TRANSIENT_ERRORS;
    };

  global.PlaudPopup.EXPORT_STATUS_TIMEOUT_MS = DEFAULT_STATUS_TIMEOUT_MS;
  global.PlaudPopup.MAX_EXPORT_POLL_TRANSIENT_ERRORS =
    MAX_POLL_TRANSIENT_ERRORS;
})(globalThis);
