(function (global) {
  "use strict";

  const PP = global.PlaudPopup;

  /**
   * @param {ReturnType<typeof PP.createState>} ctx
   */
  PP.initExport = function initExport(ctx) {
    if (!ctx.getExportModeLabel) {
      throw new Error("ctx.getExportModeLabel must be set before initExport");
    }

    PP.initExportView(ctx);
    PP.initExportPolling(ctx);
    PP.initExportActions(ctx);
  };
})(window);
