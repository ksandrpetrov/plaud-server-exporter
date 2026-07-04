(function (global) {
  "use strict";

  const PP = global.PlaudPopup;

  /**
   * @param {ReturnType<typeof PP.createState>} ctx
   */
  PP.initTabs = function initTabs(ctx) {
    ctx.getFocusedTab = function getFocusedTab(callback) {
      if (!ctx.hasChromeExtensionApi) {
        callback(new Error(ctx.tr("error.apiUnavailable")), null);
        return;
      }
      chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        function (tabs) {
          if (chrome.runtime.lastError) {
            callback(new Error(chrome.runtime.lastError.message), null);
            return;
          }
          if (!tabs?.length) {
            callback(new Error(ctx.tr("error.noActiveTab")), null);
            return;
          }
          const tab = tabs[0];
          if (!tab || tab.id == null) {
            callback(new Error(ctx.tr("error.noActiveTab")), null);
            return;
          }
          callback(null, tab);
        }
      );
    };

    ctx.ensureActiveTabHasUrl = function ensureActiveTabHasUrl(tab, callback) {
      if (
        !tab ||
        tab.id == null ||
        tab.url ||
        tab.pendingUrl ||
        !ctx.hasChromeExtensionApi ||
        !chrome.tabs ||
        !chrome.tabs.get
      ) {
        callback(tab);
        return;
      }
      chrome.tabs.get(tab.id, function (full) {
        if (chrome.runtime.lastError || !full) {
          callback(tab);
          return;
        }
        callback(full);
      });
    };

    ctx.isPlaudTab = function isPlaudTab(tab) {
      const tabUrl = tab?.url || tab?.pendingUrl;
      if (!tabUrl) return false;
      try {
        const url = new URL(tabUrl);
        return (
          url.protocol === "https:" && ctx.PLAUD_HOSTS.includes(url.hostname)
        );
      } catch {
        return false;
      }
    };

    ctx.getPlaudTabHelpText = function getPlaudTabHelpText(actionText) {
      return ctx.tr("help.openRepeat", {
        url: ctx.PLAUD_URL_HINT,
        action: actionText,
      });
    };

    ctx.openPlaudWebSite = function openPlaudWebSite() {
      if (ctx.hasChromeExtensionApi) {
        chrome.tabs.create({ url: ctx.PLAUD_URL_HINT, active: true });
      } else {
        window.open(ctx.PLAUD_URL_HINT, "_blank", "noopener,noreferrer");
      }
    };

    ctx.updateTabBadgeOpenPlaudAction =
      function updateTabBadgeOpenPlaudAction() {
        const { tabStateBadge } = ctx.els;
        if (!tabStateBadge) return;
        const clickable = tabStateBadge.classList.contains("badge--offline");
        if (clickable) {
          tabStateBadge.setAttribute("role", "button");
          tabStateBadge.setAttribute("tabindex", "0");
          tabStateBadge.title = ctx.tr("badge.openPlaudWeb");
        } else {
          tabStateBadge.removeAttribute("role");
          tabStateBadge.removeAttribute("tabindex");
          tabStateBadge.removeAttribute("title");
        }
      };

    ctx.setRecordingPreview = function setRecordingPreview(recording) {
      const { recordingTitle, recordingSubtitle } = ctx.els;
      if (!recordingTitle) return;
      if (recording?.title) {
        recordingTitle.textContent = recording.title;
        recordingTitle.classList.remove("recording-title--placeholder");
      } else if (recording?.id) {
        recordingTitle.textContent = ctx.tr("hero.downloadCurrent");
        recordingTitle.classList.add("recording-title--placeholder");
      } else {
        recordingTitle.textContent = ctx.tr("main.noRecording");
        recordingTitle.classList.add("recording-title--placeholder");
      }
      if (recordingSubtitle) {
        recordingSubtitle.textContent = ctx.tr("main.subtitle");
      }
    };

    ctx.refreshRecordingPreview = function refreshRecordingPreview(tab) {
      if (!tab || !ctx.isPlaudTab(tab)) {
        ctx.setRecordingPreview(null);
        return;
      }
      ctx.pingContentBusyState(tab, function (ping) {
        if (ping?.currentRecording) {
          ctx.setRecordingPreview(ping.currentRecording);
        } else {
          ctx.setRecordingPreview(null);
        }
      });
    };

    ctx.setPlaudTabState = function setPlaudTabState(tab) {
      ctx.activeTabIsPlaud = ctx.isPlaudTab(tab);
      const { readyPanel, offlinePanel, tabStateBadge } = ctx.els;
      if (readyPanel) readyPanel.hidden = !ctx.activeTabIsPlaud;
      if (offlinePanel) offlinePanel.hidden = ctx.activeTabIsPlaud;
      if (tabStateBadge) {
        tabStateBadge.textContent = ctx.activeTabIsPlaud
          ? ctx.tr("badge.onPlaudWeb")
          : ctx.tr("badge.openPlaudWeb");
        tabStateBadge.className = ctx.activeTabIsPlaud
          ? "badge badge--ready"
          : "badge badge--offline";
      }
      ctx.updateTabBadgeOpenPlaudAction();
      if (ctx.activeTabIsPlaud) {
        ctx.refreshRecordingPreview(tab);
      } else {
        ctx.setRecordingPreview(null);
      }
      ctx.updateExportControls();
      ctx.updateActivityIndicators();
    };

    ctx.pingContentBusyState = function pingContentBusyState(tab, callback) {
      if (!tab?.id || !ctx.isPlaudTab(tab)) {
        callback(null);
        return;
      }
      ctx.sendMessageToTabWithRecovery(
        tab,
        { action: "plaudExportPing" },
        (err, resp) => {
          if (err || !resp) {
            callback(null);
            return;
          }
          callback(resp);
        }
      );
    };

    ctx.applyContentBusyFromPing = function applyContentBusyFromPing(ping) {
      if (!ping) return;
      ctx.foregroundExportBusy = !!ping.exportRunLock;
      ctx.smartSyncActive = !!ping.smartSyncLock;
      ctx.updateExportControls();
      ctx.updateActivityIndicators();
      if (ping.currentRecording) {
        ctx.setRecordingPreview(ping.currentRecording);
      }
    };

    ctx.openSettingsSheet = function openSettingsSheet() {
      const { settingsSheet, sheetBackdrop, settingsBtn, layout } = ctx.els;
      if (!settingsSheet || !sheetBackdrop) return;
      ctx.sheetOpen = true;
      if (layout) layout.classList.add("layout--sheet-open");
      settingsSheet.hidden = false;
      sheetBackdrop.hidden = false;
      requestAnimationFrame(function () {
        settingsSheet.classList.add("sheet--open");
        sheetBackdrop.classList.add("sheet-backdrop--visible");
        settingsSheet.setAttribute("aria-hidden", "false");
        sheetBackdrop.setAttribute("aria-hidden", "false");
      });
      if (settingsBtn) {
        settingsBtn.setAttribute("aria-expanded", "true");
      }
      ctx.lazyInitSheet();
    };

    ctx.closeSettingsSheet = function closeSettingsSheet() {
      const { settingsSheet, sheetBackdrop, settingsBtn, layout } = ctx.els;
      if (!settingsSheet || !sheetBackdrop) return;
      ctx.sheetOpen = false;
      settingsSheet.classList.remove("sheet--open");
      sheetBackdrop.classList.remove("sheet-backdrop--visible");
      settingsSheet.setAttribute("aria-hidden", "true");
      sheetBackdrop.setAttribute("aria-hidden", "true");
      if (settingsBtn) {
        settingsBtn.setAttribute("aria-expanded", "false");
      }
      setTimeout(function () {
        if (!ctx.sheetOpen) {
          settingsSheet.hidden = true;
          sheetBackdrop.hidden = true;
          if (layout) layout.classList.remove("layout--sheet-open");
        }
      }, 260);
    };

    ctx.lazyInitSheet = function lazyInitSheet() {
      if (ctx.sheetInitialized) return;
      ctx.sheetInitialized = true;
      ctx.loadSyncSettings();
      ctx.loadCachedLibraryStats(function (cached) {
        if (
          cached &&
          Number.isFinite(Number(cached.recordings)) &&
          Number.isFinite(Number(cached.summaries))
        ) {
          ctx.renderArchiveStrip(cached.recordings, cached.summaries, {
            cachedAt: cached.updatedAt,
          });
        } else {
          ctx.renderArchiveStrip(0, 0, {
            offline: true,
            phaseMessage: ctx.tr("stats.waitLogin"),
          });
        }
      });
    };

    ctx.bindTabUi = function bindTabUi() {
      const { tabStateBadge, offlineOpenPlaudBtn } = ctx.els;
      if (tabStateBadge) {
        tabStateBadge.addEventListener("click", function () {
          if (tabStateBadge.classList.contains("badge--offline"))
            ctx.openPlaudWebSite();
        });
        tabStateBadge.addEventListener("keydown", function (ev) {
          if (!tabStateBadge.classList.contains("badge--offline")) return;
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          ctx.openPlaudWebSite();
        });
      }
      if (offlineOpenPlaudBtn) {
        offlineOpenPlaudBtn.addEventListener("click", ctx.openPlaudWebSite);
      }
    };
  };
})(window);
