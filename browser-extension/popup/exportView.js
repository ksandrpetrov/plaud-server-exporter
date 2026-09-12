(function (global) {
  "use strict";
  const PP = global.PlaudPopup;
  /** @param {ReturnType<typeof PP.createState>} ctx */
  PP.initExportView = function (ctx) {
    ctx.updateAdvancedExportModeUi = function updateAdvancedExportModeUi() {
      const { exportModeBothBtn, exportModeAudioBtn } = ctx.els;
      if (exportModeBothBtn) {
        exportModeBothBtn.classList.toggle(
          "segment-group__item--active",
          ctx.selectedAdvancedExportMode === ctx.EXPORT_MODE_BOTH
        );
      }
      if (exportModeAudioBtn) {
        exportModeAudioBtn.classList.toggle(
          "segment-group__item--active",
          ctx.selectedAdvancedExportMode === ctx.EXPORT_MODE_AUDIO
        );
      }
    };

    ctx.formatForegroundExportResult = function formatForegroundExportResult(
      data
    ) {
      return PP.formatForegroundExportResult(data, ctx);
    };

    ctx.updateDownloadBusyUi = function updateDownloadBusyUi() {
      const { downloadBtn, downloadBtnLabel, downloadBtnSpinner } = ctx.els;
      const busy = ctx.foregroundExportBusy && ctx.activeTabIsPlaud;
      if (downloadBtn) {
        downloadBtn.setAttribute("aria-busy", busy ? "true" : "false");
      }
      if (downloadBtnLabel) {
        downloadBtnLabel.hidden = busy;
        if (!busy) downloadBtnLabel.textContent = ctx.tr("main.download");
      }
      if (downloadBtnSpinner) {
        downloadBtnSpinner.hidden = !busy;
      }
    };

    ctx.updateActivityIndicators = function updateActivityIndicators() {
      const { settingsActivityDot, mainExportHint } = ctx.els;
      const busy = ctx.exportActive || ctx.smartSyncActive;
      if (settingsActivityDot) {
        settingsActivityDot.hidden = !busy;
      }
      if (mainExportHint) {
        if (ctx.exportActive && !ctx.sheetOpen) {
          mainExportHint.hidden = false;
          mainExportHint.textContent = ctx.tr("status.exportRunning");
        } else if (ctx.smartSyncActive && !ctx.sheetOpen) {
          mainExportHint.hidden = false;
          mainExportHint.textContent = ctx.formatSyncLine(
            ctx.lastSmartSyncData || { status: "running" }
          );
        } else {
          mainExportHint.hidden = true;
          mainExportHint.textContent = "";
        }
      }
    };

    ctx.updateStatus = function updateStatus(message, type = "info") {
      const { statusEl, copyStatusBtn } = ctx.els;
      if (ctx.statusClearTimer) {
        clearTimeout(ctx.statusClearTimer);
        ctx.statusClearTimer = null;
      }
      statusEl.textContent = message;
      statusEl.className = "status-line status-line--" + type;

      if (copyStatusBtn) {
        copyStatusBtn.hidden = type !== "error" || !message;
        copyStatusBtn.textContent = ctx.copyStatusBtnDefault;
      }

      if (type === "error" && message) return;

      ctx.statusClearTimer = setTimeout(function () {
        statusEl.textContent = "";
        statusEl.className = "status-line";
        ctx.statusClearTimer = null;
        if (copyStatusBtn) copyStatusBtn.hidden = true;
      }, 5000);
    };

    ctx.updateExportStatus = function updateExportStatus(data) {
      const { exportStatusContainer } = ctx.els;
      if (!exportStatusContainer) return;
      if (!data || data.status === "stopped") {
        ctx.lastExportStatusData = null;
        exportStatusContainer.innerHTML = "";
        delete exportStatusContainer.dataset.exportUiBuilt;
        exportStatusContainer.classList.remove("active");
        ctx.updateActivityIndicators();
        return;
      }
      ctx.lastExportStatusData = data;
      exportStatusContainer.classList.add("active");
      ctx.updateActivityIndicators();

      const startedAt = Number(data.startTime) || Date.now();
      const timeString = PP.formatExportElapsed(startedAt, ctx.tr.bind(ctx));

      const metrics = PP.computeExportStatusMetrics(data);
      const {
        audio,
        errored,
        summaries,
        summaryErrors,
        progress,
        processedLabel,
      } = metrics;

      if (!exportStatusContainer.dataset.exportUiBuilt) {
        exportStatusContainer.innerHTML = `
      <h3 class="export-status-heading"></h3>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-bar"></div>
      </div>
      <div class="status-grid">
        <div class="status-item">
          <span class="export-stat-lbl export-lbl-audio"></span>
          <span class="export-stat-num export-val-audio"></span>
        </div>
        <div class="status-item">
          <span class="export-stat-lbl export-lbl-summary"></span>
          <span class="export-stat-num export-val-summary"></span>
        </div>
        <div class="status-item">
          <span class="export-stat-lbl export-lbl-errors"></span>
          <span class="export-stat-num export-val-errors"></span>
        </div>
        <div class="status-item">
          <span class="export-stat-lbl export-lbl-elapsed"></span>
          <span class="export-stat-num export-val-elapsed"></span>
        </div>
      </div>
      <div class="status-note export-records-note"></div>`;
        exportStatusContainer.dataset.exportUiBuilt = "1";
      }

      const heading = exportStatusContainer.querySelector(
        ".export-status-heading"
      );
      if (heading) heading.textContent = ctx.tr("status.exportRunning");
      const bar = exportStatusContainer.querySelector(".progress-bar");
      if (bar) {
        /** @type {HTMLElement} */ (bar).style.width = `${progress}%`;
      }

      const lblAudio = exportStatusContainer.querySelector(".export-lbl-audio");
      const lblSummary = exportStatusContainer.querySelector(
        ".export-lbl-summary"
      );
      const lblErrors =
        exportStatusContainer.querySelector(".export-lbl-errors");
      const lblElapsed = exportStatusContainer.querySelector(
        ".export-lbl-elapsed"
      );
      if (lblAudio) lblAudio.textContent = ctx.tr("status.audio");
      if (lblSummary) lblSummary.textContent = ctx.tr("status.summary");
      if (lblErrors) lblErrors.textContent = ctx.tr("status.errors");
      if (lblElapsed) lblElapsed.textContent = ctx.tr("status.elapsed");

      const valAudio = exportStatusContainer.querySelector(".export-val-audio");
      const valSummary = exportStatusContainer.querySelector(
        ".export-val-summary"
      );
      const valErrors =
        exportStatusContainer.querySelector(".export-val-errors");
      const valElapsed = exportStatusContainer.querySelector(
        ".export-val-elapsed"
      );
      if (valAudio) valAudio.textContent = String(audio);
      if (valSummary) valSummary.textContent = String(summaries);
      if (valErrors) valErrors.textContent = String(errored + summaryErrors);
      if (valElapsed) valElapsed.textContent = timeString;

      const note = exportStatusContainer.querySelector(".export-records-note");
      if (note) {
        note.textContent = ctx.tr("status.recordsProcessed", {
          label: processedLabel,
        });
      }
    };

    ctx.updateExportControls = function updateExportControls() {
      PP.applyExportControlStates(ctx);
      ctx.updateDownloadBusyUi();
      ctx.updateActivityIndicators();
      ctx.syncForegroundBusyPolling();
    };
  };
})(globalThis);
