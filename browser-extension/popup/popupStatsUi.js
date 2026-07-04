(function (global) {
  "use strict";

  const PP = global.PlaudPopup;

  /**
   * @param {ReturnType<typeof PP.createState>} ctx
   */
  PP.initStats = function initStats(ctx) {
    ctx.formatShortRelative = function formatShortRelative(ts) {
      const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (sec < 60) return ctx.tr("time.justNow");
      const min = Math.floor(sec / 60);
      if (min < 60) return ctx.tr("time.minAgo", { n: min });
      const h = Math.floor(min / 60);
      if (h < 24) return ctx.tr("time.hourAgo", { n: h });
      const d = Math.floor(h / 24);
      return ctx.tr("time.dayAgo", { n: d });
    };

    ctx.renderArchiveStrip = function renderArchiveStrip(
      recordings,
      summaries,
      opts = {}
    ) {
      const { archiveLine, archiveStrip } = ctx.els;
      if (!archiveLine || !archiveStrip) return;
      const r = Number(recordings) || 0;
      const summariesUnknown =
        summaries === null ||
        summaries === undefined ||
        Number.isNaN(Number(summaries));
      const s = summariesUnknown ? "—" : String(Number(summaries) || 0);
      let line = ctx.tr("archive.line", { recordings: r, summaries: s });
      if (opts.cachedAt && !opts.loading) {
        line += ` · ${ctx.formatShortRelative(opts.cachedAt)}`;
      }
      if (opts.loading) line = ctx.tr("archive.loading");
      if (opts.offline && !opts.loading) {
        line = opts.phaseMessage
          ? opts.phaseMessage
          : ctx.tr("archive.offline", {
              recordings: r,
              summaries: s,
              time: opts.cachedAt
                ? ctx.formatShortRelative(opts.cachedAt)
                : "—",
            });
      }
      if (opts.phaseMessage && opts.loading) {
        line = opts.phaseMessage;
      }
      archiveLine.textContent = line;
      archiveStrip.classList.toggle("archive-strip--loading", !!opts.loading);
      archiveStrip.classList.toggle("archive-strip--offline", !!opts.offline);
    };

    ctx.persistLibraryStatsMerge = function persistLibraryStatsMerge(
      recordings,
      summariesUpdate
    ) {
      if (!ctx.hasChromeExtensionApi || !chrome.storage?.local) return;
      chrome.storage.local.get([ctx.LIBRARY_STATS_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) return;
        const prev = result[ctx.LIBRARY_STATS_STORAGE_KEY] || {};
        const nextSummaries =
          summariesUpdate === null || summariesUpdate === undefined
            ? Number(prev.summaries) || 0
            : Number(summariesUpdate) || 0;
        chrome.storage.local.set({
          [ctx.LIBRARY_STATS_STORAGE_KEY]: {
            recordings: Number(recordings) || 0,
            summaries: nextSummaries,
            updatedAt: Date.now(),
          },
        });
      });
    };

    ctx.loadCachedLibraryStats = function loadCachedLibraryStats(callback) {
      if (!ctx.hasChromeExtensionApi || !chrome.storage?.local) {
        callback(null);
        return;
      }
      chrome.storage.local.get([ctx.LIBRARY_STATS_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(result[ctx.LIBRARY_STATS_STORAGE_KEY] || null);
      });
    };

    ctx.clearStatsWatchdog = function clearStatsWatchdog() {
      if (ctx.statsWatchdogTimer) {
        clearTimeout(ctx.statsWatchdogTimer);
        ctx.statsWatchdogTimer = null;
      }
    };

    ctx.handleLibraryStatsProgress = function handleLibraryStatsProgress(data) {
      if (!data || !ctx.statsFetchInFlight) return;
      if (data.phase === "list") {
        ctx.renderArchiveStrip(
          ctx.warmStatsDuringFetch?.recordings || 0,
          ctx.warmStatsDuringFetch?.summaries || 0,
          { loading: true, phaseMessage: ctx.tr("stats.phase.list") }
        );
      }
      if (data.phase === "summaries") {
        const total = Number(data.total);
        const current = Number(data.current);
        if (Number.isFinite(total) && total > 0 && Number.isFinite(current)) {
          ctx.renderArchiveStrip(total, current, {
            loading: true,
            phaseMessage: ctx.tr("stats.phase.summariesLine", {
              current,
              total,
            }),
          });
        }
      }
    };

    ctx.refreshLibraryStatsFromTab = function refreshLibraryStatsFromTab(
      tab,
      includeSummaries,
      warmCache
    ) {
      if (!tab || !ctx.isPlaudTab(tab)) {
        ctx.updateStatus(
          ctx.getPlaudTabHelpText(ctx.tr("actions.statsRefresh")),
          "error"
        );
        return;
      }
      if (ctx.exportActive || ctx.foregroundExportBusy) {
        ctx.updateStatus(ctx.tr("error.waitExport"), "info");
        return;
      }
      const hasWarm =
        warmCache &&
        Number.isFinite(Number(warmCache.recordings)) &&
        Number.isFinite(Number(warmCache.summaries)) &&
        Number.isFinite(Number(warmCache.updatedAt));
      ctx.warmStatsDuringFetch = hasWarm
        ? {
            recordings: Number(warmCache.recordings) || 0,
            summaries: Number(warmCache.summaries) || 0,
            updatedAt: Number(warmCache.updatedAt),
          }
        : null;
      ctx.statsFetchInFlight = true;
      ctx.clearStatsWatchdog();
      const watchdogMs = includeSummaries ? 195000 : 90000;
      ctx.statsWatchdogTimer = setTimeout(() => {
        if (!ctx.statsFetchInFlight) return;
        ctx.statsFetchInFlight = false;
        ctx.warmStatsDuringFetch = null;
        if (hasWarm) {
          ctx.renderArchiveStrip(
            Number(warmCache.recordings) || 0,
            Number(warmCache.summaries) || 0,
            { cachedAt: warmCache.updatedAt, offline: true }
          );
          ctx.updateStatus(ctx.tr("stats.timeoutFootnote"), "error");
        } else {
          ctx.renderArchiveStrip(0, 0, {
            offline: true,
            phaseMessage: ctx.tr("stats.timeoutFootnote"),
          });
        }
        ctx.updateExportControls();
      }, watchdogMs);
      if (hasWarm) {
        ctx.renderArchiveStrip(
          Number(warmCache.recordings) || 0,
          Number(warmCache.summaries) || 0,
          { cachedAt: warmCache.updatedAt, loading: true }
        );
      } else {
        ctx.renderArchiveStrip(0, 0, {
          loading: true,
          phaseMessage: includeSummaries
            ? ctx.tr("stats.fullScan")
            : ctx.tr("stats.loadListSummaries"),
        });
      }
      ctx.updateExportControls();
      ctx.sendMessageToTabWithRecovery(
        tab,
        { action: "runLibraryStats", includeSummaries },
        (sendError, response) => {
          ctx.clearStatsWatchdog();
          ctx.statsFetchInFlight = false;
          ctx.warmStatsDuringFetch = null;
          if (sendError || !response?.success) {
            const msg =
              sendError?.message ||
              response?.error ||
              ctx.tr("stats.statsError");
            if (hasWarm) {
              ctx.renderArchiveStrip(
                Number(warmCache.recordings) || 0,
                Number(warmCache.summaries) || 0,
                { cachedAt: warmCache.updatedAt, offline: true }
              );
            } else {
              ctx.renderArchiveStrip(0, 0, {
                offline: true,
                phaseMessage: `${msg} ${ctx.tr("stats.retryPlaud")}`,
              });
            }
            ctx.updateExportControls();
            return;
          }
          const rec = Number(response.recordings) || 0;
          const rawSummaries = response.summaries;
          ctx.loadCachedLibraryStats((cached) => {
            ctx.persistLibraryStatsMerge(
              rec,
              rawSummaries !== null && rawSummaries !== undefined
                ? Number(rawSummaries) || 0
                : null
            );
            const renderSummaries =
              rawSummaries !== null && rawSummaries !== undefined
                ? Number(rawSummaries) || 0
                : cached && Number.isFinite(Number(cached.summaries))
                  ? Number(cached.summaries)
                  : null;
            ctx.renderArchiveStrip(rec, renderSummaries, {
              cachedAt: Date.now(),
            });
            ctx.updateExportControls();
          });
        }
      );
    };

    ctx.bindStatsUi = function bindStatsUi() {
      const { statsRefreshBtn } = ctx.els;
      if (statsRefreshBtn) {
        statsRefreshBtn.addEventListener("click", function () {
          ctx.getFocusedTab((tabError, tab) => {
            if (tabError || !tab) {
              ctx.updateStatus(ctx.tr("error.statsTab"), "error");
              return;
            }
            ctx.ensureActiveTabHasUrl(tab, function (resolved) {
              ctx.loadCachedLibraryStats(function (cached) {
                const warm =
                  cached &&
                  Number.isFinite(Number(cached.recordings)) &&
                  Number.isFinite(Number(cached.summaries))
                    ? {
                        recordings: cached.recordings,
                        summaries: cached.summaries,
                        updatedAt: cached.updatedAt,
                      }
                    : null;
                ctx.refreshLibraryStatsFromTab(resolved, true, warm);
              });
            });
          });
        });
      }
    };
  };
})(window);
