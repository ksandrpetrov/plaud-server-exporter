(function (global) {
  "use strict";

  global.PlaudPopup = global.PlaudPopup || {};

  /**
   * @param {ReturnType<typeof global.PlaudPopup.createState>} ctx
   */
  global.PlaudPopup.applyExportControlStates =
    function applyExportControlStates(ctx) {
      const {
        stopExportBtn,
        statsRefreshBtn,
        syncFolderInput,
        openDownloadsBtn,
      } = ctx.els;
      const blockExportActions =
        ctx.exportActive || ctx.foregroundExportBusy || ctx.smartSyncActive;
      if (blockExportActions) {
        ctx.exportActionButtons.forEach((button) => {
          if (button) button.disabled = true;
        });
      } else {
        ctx.exportActionButtons.forEach((button) => {
          if (button) button.disabled = !ctx.activeTabIsPlaud;
        });
      }
      if (stopExportBtn) {
        if (ctx.exportActive) {
          stopExportBtn.disabled = false;
          stopExportBtn.hidden = false;
        } else {
          stopExportBtn.disabled = true;
          stopExportBtn.hidden = true;
        }
      }
      if (statsRefreshBtn) {
        statsRefreshBtn.disabled =
          ctx.statsFetchInFlight ||
          ctx.exportActive ||
          ctx.foregroundExportBusy ||
          ctx.smartSyncActive ||
          !ctx.activeTabIsPlaud;
      }
      if (syncFolderInput) {
        syncFolderInput.disabled = ctx.smartSyncActive;
      }
      if (openDownloadsBtn) {
        openDownloadsBtn.disabled = false;
      }
    };
})(globalThis);
