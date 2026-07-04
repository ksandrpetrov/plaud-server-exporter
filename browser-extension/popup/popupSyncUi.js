(function (global) {
  "use strict";

  const PP = global.PlaudPopup;

  /**
   * @param {ReturnType<typeof PP.createState>} ctx
   */
  PP.initSync = function initSync(ctx) {
    ctx.updateSyncModeToggleUi = function updateSyncModeToggleUi() {
      const { syncModeBothBtn, syncModeSummaryBtn } = ctx.els;
      if (syncModeBothBtn) {
        syncModeBothBtn.classList.toggle(
          "segment-group__item--active",
          ctx.selectedSyncMode === ctx.SYNC_MODE_BOTH
        );
      }
      if (syncModeSummaryBtn) {
        syncModeSummaryBtn.classList.toggle(
          "segment-group__item--active",
          ctx.selectedSyncMode === ctx.SYNC_MODE_SUMMARY
        );
      }
    };

    ctx.persistSyncMode = function persistSyncMode(mode) {
      ctx.sendRuntimeMessage(
        { action: "setSyncMode", syncMode: mode },
        () => {}
      );
    };

    ctx.scheduleSyncFolderSave = function scheduleSyncFolderSave() {
      const { syncFolderInput } = ctx.els;
      if (ctx.syncFolderSaveTimer) clearTimeout(ctx.syncFolderSaveTimer);
      ctx.syncFolderSaveTimer = setTimeout(function () {
        ctx.syncFolderSaveTimer = null;
        const syncSubdirectory =
          syncFolderInput?.value?.trim() || ctx.DEFAULT_SYNC_SUBDIRECTORY;
        ctx.sendRuntimeMessage(
          { action: "setSyncSubdirectory", syncSubdirectory },
          (sendError, response) => {
            if (sendError || !response?.success) return;
            if (syncFolderInput) {
              syncFolderInput.value =
                response.settings?.syncSubdirectory || syncSubdirectory;
            }
          }
        );
      }, 450);
    };

    ctx.loadSyncSettings = function loadSyncSettings() {
      const { syncFolderInput } = ctx.els;
      ctx.sendRuntimeMessage(
        { action: "getSyncSettings" },
        (sendError, response) => {
          if (sendError || !response?.success) {
            if (syncFolderInput)
              syncFolderInput.value = ctx.DEFAULT_SYNC_SUBDIRECTORY;
            ctx.renderSmartSyncStatus({
              status: "idle",
              lastMessage:
                response?.error ||
                sendError?.message ||
                ctx.tr("sync.settingsUnavailable"),
            });
            return;
          }
          const subdir =
            response.settings?.syncSubdirectory ||
            ctx.DEFAULT_SYNC_SUBDIRECTORY;
          if (syncFolderInput) syncFolderInput.value = subdir;
          const syncMode = response.settings?.syncMode;
          if (
            syncMode === ctx.SYNC_MODE_SUMMARY ||
            syncMode === ctx.SYNC_MODE_BOTH
          ) {
            ctx.selectedSyncMode = syncMode;
          }
          ctx.updateSyncModeToggleUi();
          if (response.summary) {
            ctx.renderSmartSyncStatus({ status: "idle", ...response.summary });
          }
        }
      );
    };

    ctx.formatSyncLine = function formatSyncLine(data) {
      if (!data) return "";
      if (data.status === "running") {
        const processed = Number(data.processed) || 0;
        const total = Number(data.total) || 0;
        const scope = total > 0 ? `${processed}/${total}` : String(processed);
        return ctx.tr("sync.runningLine", {
          scope,
          n: Number(data.new) || 0,
          u: Number(data.updated) || 0,
          s: Number(data.skipped) || 0,
        });
      }
      if (data.status === "completed") {
        return ctx.tr("sync.doneLine", {
          n: Number(data.new) || 0,
          u: Number(data.updated) || 0,
          s: Number(data.skipped) || 0,
          e: Number(data.errors) || 0,
        });
      }
      if (data.status === "error") {
        return ctx.tr("sync.errorLine", {
          msg: data.error || ctx.tr("error.unknown"),
        });
      }
      if (Number.isFinite(Number(data.records))) {
        const parsedLastSync = Date.parse(data.lastSyncedAt || "");
        return ctx.tr("sync.indexLine", {
          n: Number(data.records) || 0,
          time: Number.isFinite(parsedLastSync)
            ? ctx.formatShortRelative(parsedLastSync)
            : "—",
        });
      }
      return data.lastMessage || ctx.tr("sync.idleLine");
    };

    ctx.renderSmartSyncStatus = function renderSmartSyncStatus(data) {
      const { syncStatusEl } = ctx.els;
      if (!syncStatusEl) return;
      ctx.lastSmartSyncData = data || ctx.lastSmartSyncData;
      const line = ctx.formatSyncLine(data || ctx.lastSmartSyncData);
      const detail =
        data?.lastMessage && data.status !== "idle" ? data.lastMessage : "";
      syncStatusEl.innerHTML = "";
      if (!line) return;
      const strong = document.createElement("strong");
      strong.textContent = line;
      syncStatusEl.appendChild(strong);
      if (detail) {
        syncStatusEl.appendChild(document.createElement("br"));
        syncStatusEl.appendChild(document.createTextNode(detail));
      }
      ctx.updateActivityIndicators();
    };

    ctx.stopSmartSyncPolling = function stopSmartSyncPolling() {
      if (ctx.smartSyncPollingInterval) {
        clearInterval(ctx.smartSyncPollingInterval);
        ctx.smartSyncPollingInterval = null;
      }
    };

    ctx.refreshSmartSyncStatus = function refreshSmartSyncStatus(tab) {
      if (!tab?.id || !ctx.activeTabIsPlaud) {
        ctx.smartSyncActive = false;
        ctx.currentSmartSyncTabId = null;
        ctx.stopSmartSyncPolling();
        ctx.updateActivityIndicators();
        return;
      }
      ctx.sendRuntimeMessage(
        { action: "getSmartSyncStatus", tabId: tab.id },
        (sendError, response) => {
          if (sendError || !response?.success) return;
          ctx.smartSyncActive = !!response.isRunning;
          ctx.currentSmartSyncTabId = ctx.smartSyncActive ? tab.id : null;
          if (response.syncData) ctx.renderSmartSyncStatus(response.syncData);
          if (ctx.smartSyncActive) ctx.startSmartSyncPolling();
          ctx.updateExportControls();
          ctx.updateActivityIndicators();
        }
      );
    };

    ctx.startSmartSyncPolling = function startSmartSyncPolling() {
      if (ctx.smartSyncPollingInterval)
        clearInterval(ctx.smartSyncPollingInterval);
      ctx.smartSyncPollingInterval = setInterval(() => {
        const tabId = ctx.currentSmartSyncTabId;
        if (!tabId) {
          ctx.stopSmartSyncPolling();
          return;
        }
        ctx.sendRuntimeMessage(
          { action: "getSmartSyncStatus", tabId },
          (sendError, response) => {
            if (sendError || !response?.success) return;
            ctx.smartSyncActive = !!response.isRunning;
            if (response.syncData) ctx.renderSmartSyncStatus(response.syncData);
            if (!ctx.smartSyncActive) {
              ctx.currentSmartSyncTabId = null;
              ctx.stopSmartSyncPolling();
              ctx.updateExportControls();
              ctx.updateActivityIndicators();
            }
          }
        );
      }, 2000);
    };

    ctx.bindSyncUi = function bindSyncUi() {
      const {
        syncFolderInput,
        syncModeBothBtn,
        syncModeSummaryBtn,
        openDownloadsBtn,
        syncIcloudCmdEl,
        syncIcloudCopyBtn,
        smartSyncBtn,
      } = ctx.els;

      if (syncFolderInput) {
        syncFolderInput.addEventListener("input", ctx.scheduleSyncFolderSave);
        syncFolderInput.addEventListener("change", ctx.scheduleSyncFolderSave);
      }

      if (syncModeBothBtn) {
        syncModeBothBtn.addEventListener("click", function () {
          if (ctx.selectedSyncMode === ctx.SYNC_MODE_BOTH) return;
          ctx.selectedSyncMode = ctx.SYNC_MODE_BOTH;
          ctx.updateSyncModeToggleUi();
          ctx.persistSyncMode(ctx.SYNC_MODE_BOTH);
        });
      }
      if (syncModeSummaryBtn) {
        syncModeSummaryBtn.addEventListener("click", function () {
          if (ctx.selectedSyncMode === ctx.SYNC_MODE_SUMMARY) return;
          ctx.selectedSyncMode = ctx.SYNC_MODE_SUMMARY;
          ctx.updateSyncModeToggleUi();
          ctx.persistSyncMode(ctx.SYNC_MODE_SUMMARY);
        });
      }

      if (openDownloadsBtn) {
        openDownloadsBtn.addEventListener("click", function () {
          ctx.sendRuntimeMessage(
            { action: "showDefaultDownloadsFolder" },
            () => {}
          );
        });
      }

      if (syncIcloudCmdEl) {
        syncIcloudCmdEl.textContent = ctx.ICLOUD_SYMLINK_COMMAND;
      }

      if (syncIcloudCopyBtn) {
        syncIcloudCopyBtn.addEventListener("click", function () {
          if (ctx.syncIcloudCopyResetTimer) {
            clearTimeout(ctx.syncIcloudCopyResetTimer);
            ctx.syncIcloudCopyResetTimer = null;
          }
          ctx.copyTextToClipboard(ctx.ICLOUD_SYMLINK_COMMAND).then(
            function () {
              syncIcloudCopyBtn.textContent = ctx.tr("sync.icloudTipCopied");
              ctx.syncIcloudCopyResetTimer = setTimeout(function () {
                syncIcloudCopyBtn.textContent = ctx.tr("sync.icloudTipCopy");
                ctx.syncIcloudCopyResetTimer = null;
              }, 2000);
            },
            function () {
              syncIcloudCopyBtn.textContent = ctx.tr(
                "sync.icloudTipCopyFailed"
              );
              ctx.syncIcloudCopyResetTimer = setTimeout(function () {
                syncIcloudCopyBtn.textContent = ctx.tr("sync.icloudTipCopy");
                ctx.syncIcloudCopyResetTimer = null;
              }, 2000);
            }
          );
        });
      }

      if (smartSyncBtn) {
        smartSyncBtn.addEventListener("click", function () {
          ctx.getFocusedTab((tabError, tab) => {
            if (tabError) {
              ctx.updateStatus(
                ctx.tr("sync.startError", { msg: tabError.message }),
                "error"
              );
              return;
            }
            ctx.ensureActiveTabHasUrl(tab, function (resolved) {
              if (!ctx.isPlaudTab(resolved)) {
                ctx.updateStatus(
                  ctx.getPlaudTabHelpText(ctx.tr("actions.smartSync")),
                  "error"
                );
                return;
              }
              if (
                ctx.smartSyncActive ||
                ctx.exportActive ||
                ctx.foregroundExportBusy
              ) {
                ctx.updateStatus(ctx.tr("sync.busy"), "info");
                return;
              }
              const syncSubdirectory =
                syncFolderInput?.value?.trim() || ctx.DEFAULT_SYNC_SUBDIRECTORY;
              smartSyncBtn.disabled = true;
              ctx.renderSmartSyncStatus({
                status: "running",
                processed: 0,
                total: 0,
                new: 0,
                updated: 0,
                skipped: 0,
                lastMessage: ctx.tr("sync.starting"),
              });
              ctx.sendRuntimeMessage(
                {
                  action: "startSmartSync",
                  tabId: resolved.id,
                  syncSubdirectory,
                  syncMode: ctx.selectedSyncMode,
                },
                (sendError, response) => {
                  if (sendError || !response?.success) {
                    ctx.smartSyncActive = false;
                    ctx.currentSmartSyncTabId = null;
                    ctx.renderSmartSyncStatus({
                      status: "error",
                      error:
                        response?.error ||
                        sendError?.message ||
                        ctx.tr("error.unknown"),
                    });
                    ctx.updateStatus(
                      ctx.tr("sync.startError", {
                        msg:
                          response?.error ||
                          sendError?.message ||
                          ctx.tr("error.unknown"),
                      }),
                      "error"
                    );
                  } else {
                    ctx.smartSyncActive = true;
                    ctx.currentSmartSyncTabId = resolved.id;
                    ctx.updateStatus(ctx.tr("sync.started"), "success");
                    ctx.startSmartSyncPolling();
                  }
                  ctx.updateExportControls();
                }
              );
            });
          });
        });
      }
    };
  };
})(window);
