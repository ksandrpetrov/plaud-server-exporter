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

    ctx.stopStatusPolling = function stopStatusPolling() {
      if (ctx.statusPollingInterval) {
        clearInterval(ctx.statusPollingInterval);
        ctx.statusPollingInterval = null;
      }
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

    ctx.stopForegroundBusyPolling = function stopForegroundBusyPolling() {
      if (ctx.foregroundBusyPollInterval) {
        clearInterval(ctx.foregroundBusyPollInterval);
        ctx.foregroundBusyPollInterval = null;
      }
    };

    ctx.syncForegroundBusyPolling = function syncForegroundBusyPolling() {
      const shouldPoll = ctx.foregroundExportBusy && ctx.activeTabIsPlaud;
      if (!shouldPoll) {
        ctx.stopForegroundBusyPolling();
        return;
      }
      if (ctx.foregroundBusyPollInterval) return;
      ctx.foregroundBusyPollInterval = setInterval(function () {
        ctx.getFocusedTab(function (tabError, tab) {
          if (tabError || !tab || !ctx.isPlaudTab(tab)) return;
          ctx.pingContentBusyState(tab, ctx.applyContentBusyFromPing);
        });
      }, 2000);
    };

    ctx.updateExportControls = function updateExportControls() {
      PP.applyExportControlStates(ctx);
      ctx.updateDownloadBusyUi();
      ctx.updateActivityIndicators();
      ctx.syncForegroundBusyPolling();
    };

    ctx.startStatusPolling = function startStatusPolling() {
      ctx.exportPollTransientErrors = 0;
      if (ctx.statusPollingInterval) {
        clearInterval(ctx.statusPollingInterval);
      }
      ctx.statusPollingInterval = setInterval(() => {
        ctx.getFocusedTab((tabError, tab) => {
          const tabId =
            ctx.currentExportTabId != null ? ctx.currentExportTabId : tab?.id;
          if (tabError && !tabId) return;
          ctx.sendRuntimeMessage(
            { action: "getExportStatus", tabId },
            (sendError, response) => {
              if (sendError) {
                ctx.exportPollTransientErrors += 1;
                if (
                  ctx.exportPollTransientErrors >=
                  PP.MAX_EXPORT_POLL_TRANSIENT_ERRORS
                ) {
                  ctx.stopStatusPolling();
                  ctx.exportActive = false;
                  ctx.currentExportTabId = null;
                  ctx.exportPollTransientErrors = 0;
                  ctx.updateExportStatus(null);
                  ctx.updateExportControls();
                }
                return;
              }
              ctx.exportPollTransientErrors = 0;
              if (response && response.success) {
                ctx.exportActive = response.isRunning;
                if (ctx.exportActive && response.exportData) {
                  ctx.updateExportStatus(response.exportData);
                } else {
                  ctx.stopStatusPolling();
                  ctx.exportActive = false;
                  ctx.currentExportTabId = null;
                  ctx.updateExportControls();
                  ctx.updateExportStatus(null);
                }
              }
            }
          );
        });
      }, 2000);
    };

    ctx.startForegroundExport = function startForegroundExport(exportMode) {
      ctx.getFocusedTab((tabError, tab) => {
        if (tabError) {
          ctx.updateStatus(
            ctx.tr("error.exportPrefix", { msg: tabError.message }),
            "error"
          );
          return;
        }
        ctx.ensureActiveTabHasUrl(tab, function (resolved) {
          if (!ctx.isPlaudTab(resolved)) {
            ctx.updateStatus(
              ctx.getPlaudTabHelpText(
                ctx.tr("actions.export", {
                  mode: ctx.getExportModeLabel(exportMode),
                })
              ),
              "error"
            );
            return;
          }
          ctx.exportActionButtons.forEach((button) => {
            if (button) button.disabled = true;
          });
          ctx.sendMessageToTabWithRecovery(
            resolved,
            { action: "runExportAll", background: false, exportMode },
            (sendError, response) => {
              PP.handleForegroundExportSendResult(
                ctx,
                exportMode,
                sendError,
                response
              );
            }
          );
        });
      });
    };

    ctx.startCurrentPageExport = function startCurrentPageExport(exportMode) {
      ctx.getFocusedTab((tabError, tab) => {
        if (tabError) {
          ctx.updateStatus(
            ctx.tr("error.exportPrefix", { msg: tabError.message }),
            "error"
          );
          return;
        }
        ctx.ensureActiveTabHasUrl(tab, function (resolved) {
          if (!ctx.isPlaudTab(resolved)) {
            ctx.updateStatus(
              ctx.getPlaudTabHelpText(
                ctx.tr("actions.exportCurrent", {
                  mode: ctx.getExportModeLabel(exportMode),
                })
              ),
              "error"
            );
            return;
          }
          ctx.exportActionButtons.forEach((button) => {
            if (button) button.disabled = true;
          });
          ctx.sendMessageToTabWithRecovery(
            resolved,
            { action: "runExportCurrentPage", exportMode },
            (sendError, response) => {
              PP.handleCurrentPageExportSendResult(
                ctx,
                exportMode,
                sendError,
                response
              );
            }
          );
        });
      });
    };

    ctx.checkExportStatus = function checkExportStatus() {
      const { readyPanel, offlinePanel, tabStateBadge } = ctx.els;
      ctx.getFocusedTab((tabError, tab) => {
        if (tabError) {
          ctx.activeTabIsPlaud = false;
          if (readyPanel) readyPanel.hidden = true;
          if (offlinePanel) offlinePanel.hidden = false;
          if (tabStateBadge) {
            tabStateBadge.textContent = ctx.tr("badge.noTab");
            tabStateBadge.className = "badge badge--offline";
          }
          ctx.updateTabBadgeOpenPlaudAction();
          ctx.setRecordingPreview(null);
          ctx.updateExportControls();
          return;
        }

        ctx.ensureActiveTabHasUrl(tab, function (focusedResolved) {
          ctx.runAfterNextPaint(function () {
            ctx.setPlaudTabState(focusedResolved);
            ctx.refreshSmartSyncStatus(focusedResolved);
            ctx.pingContentBusyState(
              focusedResolved,
              ctx.applyContentBusyFromPing
            );

            const statusTabId = PP.resolveExportStatusTabId({
              exportActive: ctx.exportActive,
              currentExportTabId: ctx.currentExportTabId,
              focusedTab: focusedResolved,
              isPlaudTab: ctx.isPlaudTab.bind(ctx),
            });

            if (statusTabId == null) {
              ctx.sendRuntimeMessage(
                { action: "getAnyRunningExport" },
                function (sendErr, anyResp) {
                  if (
                    !sendErr &&
                    PP.shouldResumeFromAnyRunningExport(anyResp)
                  ) {
                    ctx.exportActive = true;
                    ctx.currentExportTabId = anyResp.tabId;
                    ctx.exportPollTransientErrors = 0;
                    if (anyResp.exportData) {
                      ctx.updateExportStatus(anyResp.exportData);
                      ctx.startStatusPolling();
                    }
                    ctx.updateActivityIndicators();
                  } else {
                    ctx.stopStatusPolling();
                    ctx.exportActive = false;
                    ctx.currentExportTabId = null;
                    ctx.exportPollTransientErrors = 0;
                    ctx.updateExportStatus(null);
                    ctx.updateActivityIndicators();
                  }
                  ctx.updateExportControls();
                }
              );
              return;
            }

            const finalizer = PP.createExportStatusFinalizer({
              timeoutMs: PP.EXPORT_STATUS_TIMEOUT_MS,
              onFinalize(sendError, response) {
                if (sendError) {
                  ctx.updateExportControls();
                  return;
                }
                if (response && response.success) {
                  ctx.exportActive = response.isRunning;
                  ctx.currentExportTabId = ctx.exportActive
                    ? statusTabId
                    : null;
                  if (ctx.exportActive && response.exportData) {
                    ctx.updateExportStatus(response.exportData);
                    ctx.startStatusPolling();
                  } else {
                    ctx.stopStatusPolling();
                    ctx.exportPollTransientErrors = 0;
                    ctx.updateExportStatus(null);
                  }
                  ctx.updateActivityIndicators();
                  ctx.updateExportControls();
                } else {
                  ctx.updateExportControls();
                }
              },
            });

            ctx.sendRuntimeMessage(
              { action: "getExportStatus", tabId: statusTabId },
              function (sendError, response) {
                finalizer.finalize(sendError, response);
              }
            );
          });
        });
      });
    };

    ctx.copyTextToClipboard = function copyTextToClipboard(text) {
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise((resolve, reject) => {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy") ? resolve() : reject(new Error("copy"));
        } catch (error) {
          reject(error);
        } finally {
          textarea.remove();
        }
      });
    };

    ctx.bindExportUi = function bindExportUi() {
      const {
        downloadBtn,
        exportAllSummariesBtn,
        exportAllBtn,
        exportCurrentBtn,
        exportBgBtn,
        stopExportBtn,
        exportModeBothBtn,
        exportModeAudioBtn,
        copyStatusBtn,
        statusEl,
      } = ctx.els;

      if (downloadBtn) {
        downloadBtn.addEventListener("click", function () {
          ctx.startCurrentPageExport(ctx.EXPORT_MODE_SUMMARY);
        });
      }

      if (exportModeBothBtn) {
        exportModeBothBtn.addEventListener("click", function () {
          if (ctx.selectedAdvancedExportMode === ctx.EXPORT_MODE_BOTH) return;
          ctx.selectedAdvancedExportMode = ctx.EXPORT_MODE_BOTH;
          ctx.updateAdvancedExportModeUi();
        });
      }
      if (exportModeAudioBtn) {
        exportModeAudioBtn.addEventListener("click", function () {
          if (ctx.selectedAdvancedExportMode === ctx.EXPORT_MODE_AUDIO) return;
          ctx.selectedAdvancedExportMode = ctx.EXPORT_MODE_AUDIO;
          ctx.updateAdvancedExportModeUi();
        });
      }

      if (exportAllSummariesBtn) {
        exportAllSummariesBtn.addEventListener("click", function () {
          ctx.startForegroundExport(ctx.EXPORT_MODE_SUMMARY);
        });
      }

      if (exportAllBtn) {
        exportAllBtn.addEventListener("click", function () {
          ctx.startForegroundExport(ctx.selectedAdvancedExportMode);
        });
      }

      if (exportCurrentBtn) {
        exportCurrentBtn.addEventListener("click", function () {
          ctx.startCurrentPageExport(ctx.selectedAdvancedExportMode);
        });
      }

      if (exportBgBtn) {
        exportBgBtn.addEventListener("click", function () {
          ctx.getFocusedTab((tabError, tab) => {
            if (tabError) {
              ctx.updateStatus(
                ctx.tr("error.bgExportFailed", { msg: tabError.message }),
                "error"
              );
              return;
            }
            ctx.ensureActiveTabHasUrl(tab, function (resolved) {
              if (!ctx.isPlaudTab(resolved)) {
                ctx.updateStatus(
                  ctx.getPlaudTabHelpText(ctx.tr("actions.bgExport")),
                  "error"
                );
                return;
              }
              exportBgBtn.disabled = true;
              ctx.sendRuntimeMessage(
                {
                  action: "startBackgroundExport",
                  tabId: resolved.id,
                  exportMode: ctx.selectedAdvancedExportMode,
                },
                (sendError, response) => {
                  if (sendError) {
                    ctx.updateStatus(
                      ctx.tr("error.bgStartFailed", { msg: sendError.message }),
                      "error"
                    );
                  } else if (response && response.success) {
                    ctx.updateStatus(ctx.tr("error.bgStarted"), "success");
                    ctx.exportActive = true;
                    ctx.currentExportTabId = resolved.id;
                    ctx.updateExportControls();
                    ctx.updateActivityIndicators();
                    ctx.startStatusPolling();
                  } else {
                    ctx.updateStatus(
                      ctx.tr("error.bgStartFailed", {
                        msg: response?.error || ctx.tr("error.unknown"),
                      }),
                      "error"
                    );
                  }
                  ctx.updateExportControls();
                }
              );
            });
          });
        });
      }

      if (stopExportBtn) {
        stopExportBtn.addEventListener("click", function () {
          const stopTabId = ctx.currentExportTabId;
          ctx.getFocusedTab((tabError, tab) => {
            const tabId = stopTabId || tab?.id;
            if (tabError && !tabId) {
              ctx.updateStatus(
                ctx.tr("error.stopFailed", { msg: tabError.message }),
                "error"
              );
              return;
            }
            if (!tabId) {
              ctx.updateStatus(ctx.tr("error.stopNoTab"), "error");
              return;
            }
            ctx.sendRuntimeMessage(
              { action: "stopExport", tabId },
              (sendError, response) => {
                if (sendError) {
                  ctx.updateStatus(
                    ctx.tr("error.stopFailed", { msg: sendError.message }),
                    "error"
                  );
                  return;
                }
                if (response && response.success) {
                  ctx.updateStatus(ctx.tr("error.stopAfterFile"), "info");
                  ctx.stopStatusPolling();
                  ctx.exportActive = false;
                  ctx.currentExportTabId = null;
                  ctx.updateExportStatus(null);
                  ctx.updateExportControls();
                  ctx.updateActivityIndicators();
                } else {
                  ctx.updateStatus(
                    ctx.tr("error.stopFailedGeneric", {
                      msg: response?.error || ctx.tr("error.unknown"),
                    }),
                    "error"
                  );
                }
              }
            );
          });
        });
      }

      if (copyStatusBtn) {
        copyStatusBtn.addEventListener("click", function () {
          const text = statusEl.textContent || "";
          if (!text.trim()) return;
          ctx.copyTextToClipboard(text).then(
            function () {
              copyStatusBtn.textContent = ctx.tr("copy.copied");
              setTimeout(function () {
                copyStatusBtn.textContent = ctx.copyStatusBtnDefault;
              }, 2000);
            },
            function () {
              copyStatusBtn.textContent = ctx.tr("copy.failed");
              setTimeout(function () {
                copyStatusBtn.textContent = ctx.copyStatusBtnDefault;
              }, 2000);
            }
          );
        });
      }
    };

    ctx.attachRuntimeMessageListener = function attachRuntimeMessageListener() {
      if (!ctx.hasChromeExtensionApi) return;
      chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "foregroundExportComplete") {
          ctx.foregroundExportBusy = false;
          const result = request.data;
          if (result?.error) {
            ctx.updateStatus(ctx.formatForegroundExportResult(result), "error");
          } else if (result) {
            const hasErrors =
              (Number(result.filesErrored) || 0) +
                (Number(result.summaryErrors) || 0) >
              0;
            ctx.updateStatus(
              ctx.formatForegroundExportResult(result),
              hasErrors ? "error" : "success"
            );
          }
          ctx.updateExportControls();
          return;
        }
        if (request.action === "libraryStatsProgress") {
          ctx.handleLibraryStatsProgress(request.data);
        }
        if (request.action === "smartSyncStatusUpdate") {
          if (request.tabId != null) ctx.currentSmartSyncTabId = request.tabId;
          ctx.smartSyncActive = request.data?.status === "running";
          ctx.renderSmartSyncStatus(request.data);
          if (!ctx.smartSyncActive) ctx.stopSmartSyncPolling();
          ctx.updateExportControls();
        }
      });
    };
  };
})(window);
