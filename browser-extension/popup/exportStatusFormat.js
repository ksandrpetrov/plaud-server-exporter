(function (global) {
  "use strict";

  global.PlaudPopup = global.PlaudPopup || {};

  /**
   * @param {unknown} value
   * @param {number} fallback
   * @returns {number}
   */
  function finiteOr(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * @param {object} data
   * @returns {{
   *   processed: number;
   *   audio: number;
   *   errored: number;
   *   summaries: number;
   *   summaryErrors: number;
   *   total: number;
   *   progress: number;
   *   processedLabel: string;
   * }}
   */
  global.PlaudPopup.computeExportStatusMetrics =
    function computeExportStatusMetrics(data) {
      const processed = finiteOr(data?.filesProcessed, 0);
      const audio = finiteOr(data?.audioExported, 0);
      const errored = finiteOr(data?.filesErrored, 0);
      const summaries = finiteOr(data?.summariesExported, 0);
      const summaryErrors = finiteOr(data?.summaryErrors, 0);
      const total = finiteOr(data?.filesTotal, 0);
      const progress =
        total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
      const processedLabel =
        total > 0 ? `${processed}/${total}` : String(processed);
      return {
        processed,
        audio,
        errored,
        summaries,
        summaryErrors,
        total,
        progress,
        processedLabel,
      };
    };

  /**
   * @param {number} startedAt
   * @param {(key: string, params?: object) => string} tr
   * @returns {string}
   */
  global.PlaudPopup.formatExportElapsed = function formatExportElapsed(
    startedAt,
    tr
  ) {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - (Number(startedAt) || Date.now())) / 1000)
    );
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return tr("time.exportElapsed", { m: minutes, s: seconds });
  };

  /**
   * @param {object | null | undefined} data
   * @param {object} ctx
   * @returns {string}
   */
  global.PlaudPopup.formatForegroundExportResult =
    function formatForegroundExportResult(data, ctx) {
      if (!data) return ctx.tr("toast.exportDoneGeneric");
      if (data.error) {
        return ctx.tr("error.exportError", { msg: data.error });
      }
      const summaries = Number(data.summariesExported) || 0;
      const audio = Number(data.audioExported) || 0;
      const errors =
        (Number(data.filesErrored) || 0) + (Number(data.summaryErrors) || 0);
      const mode = data.exportMode || ctx.EXPORT_MODE_BOTH;
      if (mode === ctx.EXPORT_MODE_SUMMARY) {
        return ctx.tr("toast.exportDoneSummary", { n: summaries, e: errors });
      }
      if (mode === ctx.EXPORT_MODE_AUDIO) {
        return ctx.tr("toast.exportDoneAudio", { n: audio, e: errors });
      }
      return ctx.tr("toast.exportDoneBoth", {
        audio,
        summaries,
        e: errors,
      });
    };
})(globalThis);
