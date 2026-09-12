(function (global) {
  "use strict";
  const PP = global.PlaudPopup;
  /** @param {ReturnType<typeof PP.createState>} ctx */
  PP.initExportActions = function (ctx) {
    let runtimeListener = null;
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
      if (!ctx.hasChromeExtensionApi || runtimeListener) return;
      runtimeListener = (request) => {
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
      };
      chrome.runtime.onMessage.addListener(runtimeListener);
      global.addEventListener(
        "pagehide",
        () => {
          chrome.runtime.onMessage.removeListener(runtimeListener);
          runtimeListener = null;
        },
        { once: true }
      );
    };
  };
})(globalThis);
