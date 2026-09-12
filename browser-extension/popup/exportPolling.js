(function (global) {
  "use strict";
  const PP = global.PlaudPopup;
  /** @param {ReturnType<typeof PP.createState>} ctx */
  PP.initExportPolling = function (ctx) {
    let generation = 0;
    let pendingStatus = null;
    let disposed = false;
    global.addEventListener(
      "pagehide",
      () => {
        disposed = true;
        ctx.stopStatusPolling();
        ctx.stopForegroundBusyPolling();
        if (ctx.statusClearTimer) clearTimeout(ctx.statusClearTimer);
      },
      { once: true }
    );
    ctx.stopStatusPolling = function stopStatusPolling() {
      generation += 1;
      pendingStatus?.cancel();
      pendingStatus = null;
      if (ctx.statusPollingInterval) {
        clearInterval(ctx.statusPollingInterval);
        ctx.statusPollingInterval = null;
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
      if (disposed || !shouldPoll) {
        ctx.stopForegroundBusyPolling();
        return;
      }
      if (ctx.foregroundBusyPollInterval) return;
      ctx.foregroundBusyPollInterval = setInterval(function () {
        ctx.getFocusedTab(function (tabError, tab) {
          if (disposed || tabError || !tab || !ctx.isPlaudTab(tab)) return;
          ctx.pingContentBusyState(tab, ctx.applyContentBusyFromPing);
        });
      }, 2000);
    };

    ctx.startStatusPolling = function startStatusPolling() {
      ctx.stopStatusPolling();
      if (disposed) return;
      ctx.exportPollTransientErrors = 0;
      const run = generation;
      ctx.statusPollingInterval = setInterval(() => {
        if (pendingStatus) return;
        const finalizer = PP.createExportStatusFinalizer({
          onFinalize(sendError, response) {
            pendingStatus = null;
            if (disposed || run !== generation) return;
            if (sendError || !response?.success) {
              ctx.exportPollTransientErrors += 1;
              if (
                !PP.shouldStopExportPollingAfterErrors(
                  ctx.exportPollTransientErrors
                )
              )
                return;
            } else {
              ctx.exportPollTransientErrors = 0;
              if (response.isRunning) {
                ctx.exportActive = true;
                if (response.exportData)
                  ctx.updateExportStatus(response.exportData);
                return;
              }
            }
            ctx.stopStatusPolling();
            ctx.exportActive = false;
            ctx.currentExportTabId = null;
            ctx.exportPollTransientErrors = 0;
            ctx.updateExportStatus(null);
            ctx.updateExportControls();
          },
        });
        pendingStatus = finalizer;
        ctx.getFocusedTab((tabError, tab) => {
          if (disposed || run !== generation || pendingStatus !== finalizer)
            return;
          const tabId = ctx.currentExportTabId ?? tab?.id;
          if (tabError && tabId == null) {
            finalizer.finalize(tabError, null);
            return;
          }
          ctx.sendRuntimeMessage(
            { action: "getExportStatus", tabId },
            finalizer.finalize
          );
        });
      }, 2000);
    };

    ctx.checkExportStatus = function checkExportStatus() {
      const run = generation;
      const stale = () => disposed || run !== generation;
      const { readyPanel, offlinePanel, tabStateBadge } = ctx.els;
      ctx.getFocusedTab((tabError, tab) => {
        if (stale()) return;
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
          if (stale()) return;
          ctx.runAfterNextPaint(function () {
            if (stale()) return;
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
                  if (stale()) return;
                  if (
                    !sendErr &&
                    PP.shouldResumeFromAnyRunningExport(anyResp)
                  ) {
                    ctx.exportActive = true;
                    ctx.currentExportTabId = anyResp.tabId;
                    ctx.exportPollTransientErrors = 0;
                    if (anyResp.exportData) {
                      ctx.updateExportStatus(anyResp.exportData);
                    }
                    ctx.startStatusPolling();
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
                pendingStatus = null;
                if (stale()) return;
                if (sendError) {
                  ctx.updateExportControls();
                  return;
                }
                if (response && response.success) {
                  ctx.exportActive = response.isRunning;
                  ctx.currentExportTabId = ctx.exportActive
                    ? statusTabId
                    : null;
                  if (ctx.exportActive) {
                    if (response.exportData)
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

            pendingStatus?.cancel();
            pendingStatus = finalizer;
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
  };
})(globalThis);
