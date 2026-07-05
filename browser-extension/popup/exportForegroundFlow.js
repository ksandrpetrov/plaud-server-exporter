(function (global) {
  "use strict";

  global.PlaudPopup = global.PlaudPopup || {};

  /**
   * @param {object} ctx
   * @param {string} exportMode
   * @param {Error | null} sendError
   * @param {object | null | undefined} response
   */
  global.PlaudPopup.handleForegroundExportSendResult =
    function handleForegroundExportSendResult(
      ctx,
      exportMode,
      sendError,
      response
    ) {
      if (sendError) {
        ctx.updateStatus(
          ctx.tr("error.startExportFailed", { url: ctx.PLAUD_URL_HINT }),
          "error"
        );
        ctx.updateExportControls();
        return;
      }
      if (response && response.success) {
        ctx.foregroundExportBusy = true;
        ctx.updateStatus(
          ctx.tr("toast.exportStarted", {
            mode: ctx.getExportModeLabel(exportMode),
          }),
          "info"
        );
      } else {
        ctx.updateStatus(
          ctx.tr("error.exportError", {
            msg: response?.error || ctx.tr("error.unknown"),
          }),
          "error"
        );
      }
      ctx.updateExportControls();
    };

  /**
   * @param {object} ctx
   * @param {string} exportMode
   * @param {Error | null} sendError
   * @param {object | null | undefined} response
   */
  global.PlaudPopup.handleCurrentPageExportSendResult =
    function handleCurrentPageExportSendResult(
      ctx,
      exportMode,
      sendError,
      response
    ) {
      if (sendError) {
        const hint =
          sendError.message &&
          !sendError.message.includes("Receiving end does not exist") &&
          !sendError.message.includes("Could not establish connection")
            ? ` (${sendError.message})`
            : "";
        ctx.updateStatus(
          ctx.tr("error.connectPage", {
            hint: hint,
            url: ctx.PLAUD_URL_HINT,
          }),
          "error"
        );
        ctx.updateExportControls();
        return;
      }
      if (response && response.success) {
        ctx.foregroundExportBusy = true;
        ctx.updateStatus(
          ctx.tr("toast.currentExportStarted", {
            mode: ctx.getExportModeLabel(exportMode),
          }),
          "info"
        );
      } else {
        ctx.updateStatus(
          ctx.contentErrorMessage(response, "error.couldNotStartCurrent"),
          "error"
        );
      }
      ctx.updateExportControls();
    };
})(globalThis);
