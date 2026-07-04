(function () {
  try {
    document.documentElement.dataset.themeEffective = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
      ? "dark"
      : "light";
  } catch {
    /* ignore */
  }
})();

document.addEventListener("DOMContentLoaded", async function () {
  const PlaudI18n = globalThis.PlaudI18n;
  if (!PlaudI18n) {
    console.error("PlaudI18n not loaded");
    return;
  }

  let uiLocale = await PlaudI18n.getEffectiveLocale();
  /** @type {"system" | "light" | "dark"} */
  let themePref = await PlaudI18n.getEffectiveThemePreference();
  const prefersDarkMq = window.matchMedia("(prefers-color-scheme: dark)");

  function resolveThemeEffectiveDark() {
    if (themePref === "dark") return true;
    if (themePref === "light") return false;
    return prefersDarkMq.matches;
  }

  function applyDocumentTheme() {
    document.documentElement.dataset.themeEffective =
      resolveThemeEffectiveDark() ? "dark" : "light";
  }

  function updateThemeToggleUi() {
    const themeSystemBtn = document.getElementById("themeSystemBtn");
    const themeLightBtn = document.getElementById("themeLightBtn");
    const themeDarkBtn = document.getElementById("themeDarkBtn");
    const sys = themePref === "system";
    [themeSystemBtn, themeLightBtn, themeDarkBtn].forEach(function (btn) {
      if (!btn) return;
      btn.classList.remove("toggle-group__item--active");
      btn.setAttribute("aria-pressed", "false");
    });
    if (themeSystemBtn && sys) {
      themeSystemBtn.classList.add("toggle-group__item--active");
      themeSystemBtn.setAttribute("aria-pressed", "true");
    }
    if (themeLightBtn && themePref === "light") {
      themeLightBtn.classList.add("toggle-group__item--active");
      themeLightBtn.setAttribute("aria-pressed", "true");
    }
    if (themeDarkBtn && themePref === "dark") {
      themeDarkBtn.classList.add("toggle-group__item--active");
      themeDarkBtn.setAttribute("aria-pressed", "true");
    }
  }

  applyDocumentTheme();
  prefersDarkMq.addEventListener("change", function () {
    if (themePref === "system") applyDocumentTheme();
  });

  function tr(key, params) {
    return PlaudI18n.t(uiLocale, key, params);
  }

  function contentErrorMessage(response, fallbackKey) {
    if (response?.errorKey) {
      return tr("error." + response.errorKey);
    }
    return response?.error || tr(fallbackKey);
  }

  function runAfterNextPaint(fn) {
    requestAnimationFrame(fn);
  }

  const downloadBtn = document.getElementById("downloadBtn");
  const downloadBtnLabel = document.getElementById("downloadBtnLabel");
  const downloadBtnSpinner = document.getElementById("downloadBtnSpinner");
  const exportAllSummariesBtn = document.getElementById(
    "exportAllSummariesBtn"
  );
  const exportAllBtn = document.getElementById("exportAllBtn");
  const exportCurrentBtn = document.getElementById("exportCurrentBtn");
  const exportBgBtn = document.getElementById("exportBgBtn");
  const stopExportBtn = document.getElementById("stopExportBtn");
  const exportModeBothBtn = document.getElementById("exportModeBothBtn");
  const exportModeAudioBtn = document.getElementById("exportModeAudioBtn");
  const readyPanel = document.getElementById("readyPanel");
  const offlinePanel = document.getElementById("offlinePanel");
  const offlineOpenPlaudBtn = document.getElementById("offlineOpenPlaudBtn");
  const smartSyncBtn = document.getElementById("smartSyncBtn");
  const openDownloadsBtn = document.getElementById("openDownloadsBtn");
  const syncFolderInput = document.getElementById("syncFolderInput");
  const syncModeBothBtn = document.getElementById("syncModeBothBtn");
  const syncModeSummaryBtn = document.getElementById("syncModeSummaryBtn");
  const syncStatusEl = document.getElementById("syncStatus");
  const syncIcloudCmdEl = document.getElementById("syncIcloudCmd");
  const syncIcloudCopyBtn = document.getElementById("syncIcloudCopyBtn");
  const statusEl = document.getElementById("status");
  const copyStatusBtn = document.getElementById("copyStatusBtn");
  const exportStatusContainer = document.getElementById("exportStatus");
  const tabStateBadge = document.getElementById("tabStateBadge");
  const recordingTitle = document.getElementById("recordingTitle");
  const recordingSubtitle = document.getElementById("recordingSubtitle");
  const archiveStrip = document.getElementById("archiveStrip");
  const archiveLine = document.getElementById("archiveLine");
  const statsRefreshBtn = document.getElementById("statsRefreshBtn");
  const langRuBtn = document.getElementById("langRuBtn");
  const langEnBtn = document.getElementById("langEnBtn");
  const themeSystemBtn = document.getElementById("themeSystemBtn");
  const themeLightBtn = document.getElementById("themeLightBtn");
  const themeDarkBtn = document.getElementById("themeDarkBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const closeSheetBtn = document.getElementById("closeSheetBtn");
  const settingsSheet = document.getElementById("settingsSheet");
  const sheetBackdrop = document.getElementById("sheetBackdrop");
  const settingsActivityDot = document.getElementById("settingsActivityDot");
  const mainExportHint = document.getElementById("mainExportHint");

  let syncIcloudCopyResetTimer = null;
  let syncFolderSaveTimer = null;
  const ICLOUD_SYMLINK_COMMAND =
    'ln -s "$HOME/Library/Mobile Documents/com~apple~CloudDocs" "$HOME/Downloads/iCloud"';
  let copyStatusBtnDefault = "";
  /** @type {ReturnType<typeof setInterval> | null} */
  let statusPollingInterval = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let smartSyncPollingInterval = null;
  let exportPollTransientErrors = 0;
  const LIBRARY_STATS_STORAGE_KEY = "plaudExporterLibraryStats";
  let statsFetchInFlight = false;
  let statsWatchdogTimer = null;
  let lastExportStatusData = null;
  let smartSyncActive = false;
  let currentSmartSyncTabId = null;
  let lastSmartSyncData = null;
  const DEFAULT_SYNC_SUBDIRECTORY = "PlaudExports/Sync";
  /** @type {{ recordings: number; summaries: number; updatedAt: number } | null} */
  let warmStatsDuringFetch = null;
  let sheetOpen = false;
  let sheetInitialized = false;

  function applyI18nToDocument() {
    document.documentElement.lang = uiLocale;
    document.title = tr("page.title");
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) el.textContent = tr(key);
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", tr(key));
    });
    var footerLangGroup = document.getElementById("footerLangGroup");
    if (footerLangGroup)
      footerLangGroup.setAttribute("aria-label", tr("footer.language"));
    var footerThemeGroup = document.getElementById("footerThemeGroup");
    if (footerThemeGroup)
      footerThemeGroup.setAttribute("aria-label", tr("footer.theme"));
    copyStatusBtnDefault = tr("btn.copyError");
    if (copyStatusBtn && copyStatusBtn.hidden) {
      copyStatusBtn.textContent = copyStatusBtnDefault;
    }
    if (langRuBtn) {
      langRuBtn.classList.toggle(
        "toggle-group__item--active",
        uiLocale === "ru"
      );
      langRuBtn.setAttribute(
        "aria-pressed",
        uiLocale === "ru" ? "true" : "false"
      );
    }
    if (langEnBtn) {
      langEnBtn.classList.toggle(
        "toggle-group__item--active",
        uiLocale === "en"
      );
      langEnBtn.setAttribute(
        "aria-pressed",
        uiLocale === "en" ? "true" : "false"
      );
    }
    updateThemeToggleUi();
    if (settingsBtn) {
      settingsBtn.setAttribute("title", tr("sheet.open"));
    }
  }

  applyI18nToDocument();

  let exportActive = false;
  let foregroundExportBusy = false;
  let activeTabIsPlaud = false;
  let currentExportTabId = null;
  let statusClearTimer = null;
  const PLAUD_HOSTS = ["app.plaud.ai", "web.plaud.ai"];
  const PLAUD_URL_HINT = "https://web.plaud.ai";
  const EXPORT_MODE_BOTH = "both";
  const EXPORT_MODE_AUDIO = "audio";
  const EXPORT_MODE_SUMMARY = "summary";
  const SYNC_MODE_BOTH = "both";
  const SYNC_MODE_SUMMARY = "summary";
  /** @type {"both" | "summary"} */
  let selectedSyncMode = SYNC_MODE_BOTH;
  /** @type {"both" | "audio"} */
  let selectedAdvancedExportMode = EXPORT_MODE_BOTH;
  const exportActionButtons = [
    downloadBtn,
    exportAllSummariesBtn,
    exportAllBtn,
    exportCurrentBtn,
    exportBgBtn,
    smartSyncBtn,
    exportModeBothBtn,
    exportModeAudioBtn,
    syncModeBothBtn,
    syncModeSummaryBtn,
  ];
  const hasChromeExtensionApi =
    typeof chrome !== "undefined" &&
    chrome.tabs &&
    chrome.runtime &&
    chrome.scripting;

  function getFocusedTab(callback) {
    if (!hasChromeExtensionApi) {
      callback(new Error(tr("error.apiUnavailable")), null);
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
          callback(new Error(tr("error.noActiveTab")), null);
          return;
        }
        const tab = tabs[0];
        if (!tab || tab.id == null) {
          callback(new Error(tr("error.noActiveTab")), null);
          return;
        }
        callback(null, tab);
      }
    );
  }

  function ensureActiveTabHasUrl(tab, callback) {
    if (
      !tab ||
      tab.id == null ||
      tab.url ||
      tab.pendingUrl ||
      !hasChromeExtensionApi ||
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
  }

  function isPlaudTab(tab) {
    const tabUrl = tab?.url || tab?.pendingUrl;
    if (!tabUrl) return false;
    try {
      const url = new URL(tabUrl);
      return url.protocol === "https:" && PLAUD_HOSTS.includes(url.hostname);
    } catch {
      return false;
    }
  }

  function getPlaudTabHelpText(actionText) {
    return tr("help.openRepeat", { url: PLAUD_URL_HINT, action: actionText });
  }

  function getExportModeLabel(exportMode) {
    if (exportMode === EXPORT_MODE_AUDIO) return tr("exportMode.audio");
    if (exportMode === EXPORT_MODE_SUMMARY) return tr("exportMode.summary");
    return tr("exportMode.both");
  }

  function openPlaudWebSite() {
    if (hasChromeExtensionApi) {
      chrome.tabs.create({ url: PLAUD_URL_HINT, active: true });
    } else {
      window.open(PLAUD_URL_HINT, "_blank", "noopener,noreferrer");
    }
  }

  function updateTabBadgeOpenPlaudAction() {
    if (!tabStateBadge) return;
    const clickable = tabStateBadge.classList.contains("badge--offline");
    if (clickable) {
      tabStateBadge.setAttribute("role", "button");
      tabStateBadge.setAttribute("tabindex", "0");
      tabStateBadge.title = tr("badge.openPlaudWeb");
    } else {
      tabStateBadge.removeAttribute("role");
      tabStateBadge.removeAttribute("tabindex");
      tabStateBadge.removeAttribute("title");
    }
  }

  function setRecordingPreview(recording) {
    if (!recordingTitle) return;
    if (recording?.title) {
      recordingTitle.textContent = recording.title;
      recordingTitle.classList.remove("recording-title--placeholder");
    } else if (recording?.id) {
      recordingTitle.textContent = tr("hero.downloadCurrent");
      recordingTitle.classList.add("recording-title--placeholder");
    } else {
      recordingTitle.textContent = tr("main.noRecording");
      recordingTitle.classList.add("recording-title--placeholder");
    }
    if (recordingSubtitle) {
      recordingSubtitle.textContent = tr("main.subtitle");
    }
  }

  function refreshRecordingPreview(tab) {
    if (!tab || !isPlaudTab(tab)) {
      setRecordingPreview(null);
      return;
    }
    pingContentBusyState(tab, function (ping) {
      if (ping?.currentRecording) {
        setRecordingPreview(ping.currentRecording);
      } else {
        setRecordingPreview(null);
      }
    });
  }

  function setPlaudTabState(tab) {
    activeTabIsPlaud = isPlaudTab(tab);
    if (readyPanel) readyPanel.hidden = !activeTabIsPlaud;
    if (offlinePanel) offlinePanel.hidden = activeTabIsPlaud;
    if (tabStateBadge) {
      tabStateBadge.textContent = activeTabIsPlaud
        ? tr("badge.onPlaudWeb")
        : tr("badge.openPlaudWeb");
      tabStateBadge.className = activeTabIsPlaud
        ? "badge badge--ready"
        : "badge badge--offline";
    }
    updateTabBadgeOpenPlaudAction();
    if (activeTabIsPlaud) {
      refreshRecordingPreview(tab);
    } else {
      setRecordingPreview(null);
    }
    updateExportControls();
    updateActivityIndicators();
  }

  function openSettingsSheet() {
    if (!settingsSheet || !sheetBackdrop) return;
    sheetOpen = true;
    settingsSheet.hidden = false;
    sheetBackdrop.hidden = false;
    requestAnimationFrame(function () {
      settingsSheet.classList.add("sheet--open");
      settingsSheet.setAttribute("aria-hidden", "false");
      sheetBackdrop.setAttribute("aria-hidden", "false");
    });
    if (settingsBtn) {
      settingsBtn.setAttribute("aria-expanded", "true");
    }
    lazyInitSheet();
  }

  function closeSettingsSheet() {
    if (!settingsSheet || !sheetBackdrop) return;
    sheetOpen = false;
    settingsSheet.classList.remove("sheet--open");
    settingsSheet.setAttribute("aria-hidden", "true");
    sheetBackdrop.setAttribute("aria-hidden", "true");
    sheetBackdrop.hidden = true;
    if (settingsBtn) {
      settingsBtn.setAttribute("aria-expanded", "false");
    }
    setTimeout(function () {
      if (!sheetOpen) settingsSheet.hidden = true;
    }, 260);
  }

  function lazyInitSheet() {
    if (sheetInitialized) return;
    sheetInitialized = true;
    loadSyncSettings();
    loadCachedLibraryStats(function (cached) {
      if (
        cached &&
        Number.isFinite(Number(cached.recordings)) &&
        Number.isFinite(Number(cached.summaries))
      ) {
        renderArchiveStrip(cached.recordings, cached.summaries, {
          cachedAt: cached.updatedAt,
        });
      } else {
        renderArchiveStrip(0, 0, {
          offline: true,
          phaseMessage: tr("stats.waitLogin"),
        });
      }
    });
  }

  function updateActivityIndicators() {
    const busy = exportActive || smartSyncActive;
    if (settingsActivityDot) {
      settingsActivityDot.hidden = !busy;
    }
    if (mainExportHint) {
      if (exportActive && !sheetOpen) {
        mainExportHint.hidden = false;
        mainExportHint.textContent = tr("status.exportRunning");
      } else if (smartSyncActive && !sheetOpen) {
        mainExportHint.hidden = false;
        mainExportHint.textContent = formatSyncLine(
          lastSmartSyncData || { status: "running" }
        );
      } else {
        mainExportHint.hidden = true;
        mainExportHint.textContent = "";
      }
    }
  }

  function updateDownloadBusyUi() {
    const busy = foregroundExportBusy && activeTabIsPlaud;
    if (downloadBtn) {
      downloadBtn.setAttribute("aria-busy", busy ? "true" : "false");
    }
    if (downloadBtnLabel) {
      downloadBtnLabel.hidden = busy;
      if (!busy) downloadBtnLabel.textContent = tr("main.download");
    }
    if (downloadBtnSpinner) {
      downloadBtnSpinner.hidden = !busy;
    }
  }

  function injectContentScript(tabId, callback) {
    if (!hasChromeExtensionApi) {
      callback(new Error(tr("error.apiUnavailable")));
      return;
    }
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          callback(new Error(chrome.runtime.lastError.message));
          return;
        }
        callback(null);
      }
    );
  }

  function sendMessageToTab(tabId, payload, callback) {
    if (!hasChromeExtensionApi) {
      callback(new Error(tr("error.apiUnavailable")), null);
      return;
    }
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        callback(new Error(chrome.runtime.lastError.message), null);
        return;
      }
      callback(null, response);
    });
  }

  function sendRuntimeMessage(payload, callback) {
    if (!hasChromeExtensionApi) {
      callback(new Error(tr("error.apiUnavailable")), null);
      return;
    }
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        callback(new Error(chrome.runtime.lastError.message), null);
        return;
      }
      callback(null, response);
    });
  }

  function isMissingReceivingEndError(error) {
    return (
      error?.message &&
      (error.message.includes("Receiving end does not exist") ||
        error.message.includes("Could not establish connection"))
    );
  }

  function retrySendMessageToTab(tabId, payload, attemptsRemaining, callback) {
    sendMessageToTab(tabId, payload, (sendError, response) => {
      if (
        !sendError ||
        attemptsRemaining <= 1 ||
        !isMissingReceivingEndError(sendError)
      ) {
        callback(sendError, response);
        return;
      }
      setTimeout(() => {
        retrySendMessageToTab(tabId, payload, attemptsRemaining - 1, callback);
      }, 250);
    });
  }

  function sendMessageToTabWithRecovery(tab, payload, callback) {
    sendMessageToTab(tab.id, payload, (sendError, response) => {
      if (!sendError) {
        callback(null, response);
        return;
      }
      if (!isMissingReceivingEndError(sendError)) {
        callback(sendError, null);
        return;
      }
      injectContentScript(tab.id, (injectError) => {
        if (injectError) {
          callback(injectError, null);
          return;
        }
        retrySendMessageToTab(tab.id, payload, 5, callback);
      });
    });
  }

  function renderArchiveStrip(recordings, summaries, opts = {}) {
    if (!archiveLine || !archiveStrip) return;
    const r = Number(recordings) || 0;
    const summariesUnknown =
      summaries === null ||
      summaries === undefined ||
      Number.isNaN(Number(summaries));
    const s = summariesUnknown ? "—" : String(Number(summaries) || 0);
    let line = tr("archive.line", { recordings: r, summaries: s });
    if (opts.cachedAt && !opts.loading) {
      line += ` · ${formatShortRelative(opts.cachedAt)}`;
    }
    if (opts.loading) line = tr("archive.loading");
    if (opts.offline && !opts.loading) {
      line = opts.phaseMessage
        ? opts.phaseMessage
        : tr("archive.offline", {
            recordings: r,
            summaries: s,
            time: opts.cachedAt ? formatShortRelative(opts.cachedAt) : "—",
          });
    }
    if (opts.phaseMessage && opts.loading) {
      line = opts.phaseMessage;
    }
    archiveLine.textContent = line;
    archiveStrip.classList.toggle("archive-strip--loading", !!opts.loading);
    archiveStrip.classList.toggle("archive-strip--offline", !!opts.offline);
  }

  function formatShortRelative(ts) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return tr("time.justNow");
    const min = Math.floor(sec / 60);
    if (min < 60) return tr("time.minAgo", { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return tr("time.hourAgo", { n: h });
    const d = Math.floor(h / 24);
    return tr("time.dayAgo", { n: d });
  }

  function formatForegroundExportResult(data) {
    if (!data) return tr("toast.exportDoneGeneric");
    if (data.error) {
      return tr("error.exportError", { msg: data.error });
    }
    const summaries = Number(data.summariesExported) || 0;
    const audio = Number(data.audioExported) || 0;
    const errors =
      (Number(data.filesErrored) || 0) + (Number(data.summaryErrors) || 0);
    const mode = data.exportMode || EXPORT_MODE_BOTH;
    if (mode === EXPORT_MODE_SUMMARY) {
      return tr("toast.exportDoneSummary", { n: summaries, e: errors });
    }
    if (mode === EXPORT_MODE_AUDIO) {
      return tr("toast.exportDoneAudio", { n: audio, e: errors });
    }
    return tr("toast.exportDoneBoth", {
      audio,
      summaries,
      e: errors,
    });
  }

  function pingContentBusyState(tab, callback) {
    if (!tab?.id || !isPlaudTab(tab)) {
      callback(null);
      return;
    }
    sendMessageToTabWithRecovery(
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
  }

  function applyContentBusyFromPing(ping) {
    if (!ping) return;
    if (ping.exportRunLock || ping.smartSyncLock) {
      foregroundExportBusy = !!ping.exportRunLock;
      smartSyncActive = !!ping.smartSyncLock;
      updateExportControls();
      updateActivityIndicators();
    }
    if (ping.currentRecording) {
      setRecordingPreview(ping.currentRecording);
    }
  }

  function updateSyncModeToggleUi() {
    if (syncModeBothBtn) {
      syncModeBothBtn.classList.toggle(
        "segment-group__item--active",
        selectedSyncMode === SYNC_MODE_BOTH
      );
    }
    if (syncModeSummaryBtn) {
      syncModeSummaryBtn.classList.toggle(
        "segment-group__item--active",
        selectedSyncMode === SYNC_MODE_SUMMARY
      );
    }
  }

  function updateAdvancedExportModeUi() {
    if (exportModeBothBtn) {
      exportModeBothBtn.classList.toggle(
        "segment-group__item--active",
        selectedAdvancedExportMode === EXPORT_MODE_BOTH
      );
    }
    if (exportModeAudioBtn) {
      exportModeAudioBtn.classList.toggle(
        "segment-group__item--active",
        selectedAdvancedExportMode === EXPORT_MODE_AUDIO
      );
    }
  }

  function persistSyncMode(mode) {
    sendRuntimeMessage({ action: "setSyncMode", syncMode: mode }, () => {});
  }

  function scheduleSyncFolderSave() {
    if (syncFolderSaveTimer) clearTimeout(syncFolderSaveTimer);
    syncFolderSaveTimer = setTimeout(function () {
      syncFolderSaveTimer = null;
      const syncSubdirectory =
        syncFolderInput?.value?.trim() || DEFAULT_SYNC_SUBDIRECTORY;
      sendRuntimeMessage(
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
  }

  function persistLibraryStatsMerge(recordings, summariesUpdate) {
    if (!hasChromeExtensionApi || !chrome.storage?.local) return;
    chrome.storage.local.get([LIBRARY_STATS_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) return;
      const prev = result[LIBRARY_STATS_STORAGE_KEY] || {};
      const nextSummaries =
        summariesUpdate === null || summariesUpdate === undefined
          ? Number(prev.summaries) || 0
          : Number(summariesUpdate) || 0;
      chrome.storage.local.set({
        [LIBRARY_STATS_STORAGE_KEY]: {
          recordings: Number(recordings) || 0,
          summaries: nextSummaries,
          updatedAt: Date.now(),
        },
      });
    });
  }

  function loadCachedLibraryStats(callback) {
    if (!hasChromeExtensionApi || !chrome.storage?.local) {
      callback(null);
      return;
    }
    chrome.storage.local.get([LIBRARY_STATS_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      callback(result[LIBRARY_STATS_STORAGE_KEY] || null);
    });
  }

  function loadSyncSettings() {
    sendRuntimeMessage({ action: "getSyncSettings" }, (sendError, response) => {
      if (sendError || !response?.success) {
        if (syncFolderInput) syncFolderInput.value = DEFAULT_SYNC_SUBDIRECTORY;
        renderSmartSyncStatus({
          status: "idle",
          lastMessage:
            response?.error ||
            sendError?.message ||
            tr("sync.settingsUnavailable"),
        });
        return;
      }
      const subdir =
        response.settings?.syncSubdirectory || DEFAULT_SYNC_SUBDIRECTORY;
      if (syncFolderInput) syncFolderInput.value = subdir;
      const syncMode = response.settings?.syncMode;
      if (syncMode === SYNC_MODE_SUMMARY || syncMode === SYNC_MODE_BOTH) {
        selectedSyncMode = syncMode;
      }
      updateSyncModeToggleUi();
      if (response.summary) {
        renderSmartSyncStatus({ status: "idle", ...response.summary });
      }
    });
  }

  function formatSyncLine(data) {
    if (!data) return "";
    if (data.status === "running") {
      const processed = Number(data.processed) || 0;
      const total = Number(data.total) || 0;
      const scope = total > 0 ? `${processed}/${total}` : String(processed);
      return tr("sync.runningLine", {
        scope,
        n: Number(data.new) || 0,
        u: Number(data.updated) || 0,
        s: Number(data.skipped) || 0,
      });
    }
    if (data.status === "completed") {
      return tr("sync.doneLine", {
        n: Number(data.new) || 0,
        u: Number(data.updated) || 0,
        s: Number(data.skipped) || 0,
        e: Number(data.errors) || 0,
      });
    }
    if (data.status === "error") {
      return tr("sync.errorLine", { msg: data.error || tr("error.unknown") });
    }
    if (Number.isFinite(Number(data.records))) {
      const parsedLastSync = Date.parse(data.lastSyncedAt || "");
      return tr("sync.indexLine", {
        n: Number(data.records) || 0,
        time: Number.isFinite(parsedLastSync)
          ? formatShortRelative(parsedLastSync)
          : "—",
      });
    }
    return data.lastMessage || tr("sync.idleLine");
  }

  function renderSmartSyncStatus(data) {
    if (!syncStatusEl) return;
    lastSmartSyncData = data || lastSmartSyncData;
    const line = formatSyncLine(data || lastSmartSyncData);
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
    updateActivityIndicators();
  }

  function stopSmartSyncPolling() {
    if (smartSyncPollingInterval) {
      clearInterval(smartSyncPollingInterval);
      smartSyncPollingInterval = null;
    }
  }

  function refreshSmartSyncStatus(tab) {
    if (!tab?.id || !activeTabIsPlaud) {
      smartSyncActive = false;
      currentSmartSyncTabId = null;
      stopSmartSyncPolling();
      updateActivityIndicators();
      return;
    }
    sendRuntimeMessage(
      { action: "getSmartSyncStatus", tabId: tab.id },
      (sendError, response) => {
        if (sendError || !response?.success) return;
        smartSyncActive = !!response.isRunning;
        currentSmartSyncTabId = smartSyncActive ? tab.id : null;
        if (response.syncData) renderSmartSyncStatus(response.syncData);
        if (smartSyncActive) startSmartSyncPolling();
        updateExportControls();
        updateActivityIndicators();
      }
    );
  }

  function startSmartSyncPolling() {
    if (smartSyncPollingInterval) clearInterval(smartSyncPollingInterval);
    smartSyncPollingInterval = setInterval(() => {
      const tabId = currentSmartSyncTabId;
      if (!tabId) {
        stopSmartSyncPolling();
        return;
      }
      sendRuntimeMessage(
        { action: "getSmartSyncStatus", tabId },
        (sendError, response) => {
          if (sendError || !response?.success) return;
          smartSyncActive = !!response.isRunning;
          if (response.syncData) renderSmartSyncStatus(response.syncData);
          if (!smartSyncActive) {
            currentSmartSyncTabId = null;
            stopSmartSyncPolling();
            updateExportControls();
            updateActivityIndicators();
          }
        }
      );
    }, 2000);
  }

  function handleLibraryStatsProgress(data) {
    if (!data || !statsFetchInFlight) return;
    if (data.phase === "list") {
      renderArchiveStrip(
        warmStatsDuringFetch?.recordings || 0,
        warmStatsDuringFetch?.summaries || 0,
        { loading: true, phaseMessage: tr("stats.phase.list") }
      );
    }
    if (data.phase === "summaries") {
      const total = Number(data.total);
      const current = Number(data.current);
      if (Number.isFinite(total) && total > 0 && Number.isFinite(current)) {
        renderArchiveStrip(total, current, {
          loading: true,
          phaseMessage: tr("stats.phase.summariesLine", {
            current,
            total,
          }),
        });
      }
    }
  }

  function clearStatsWatchdog() {
    if (statsWatchdogTimer) {
      clearTimeout(statsWatchdogTimer);
      statsWatchdogTimer = null;
    }
  }

  function refreshLibraryStatsFromTab(tab, includeSummaries, warmCache) {
    if (!tab || !isPlaudTab(tab)) {
      updateStatus(getPlaudTabHelpText(tr("actions.statsRefresh")), "error");
      return;
    }
    if (exportActive || foregroundExportBusy) {
      updateStatus(tr("error.waitExport"), "info");
      return;
    }
    const hasWarm =
      warmCache &&
      Number.isFinite(Number(warmCache.recordings)) &&
      Number.isFinite(Number(warmCache.summaries)) &&
      Number.isFinite(Number(warmCache.updatedAt));
    warmStatsDuringFetch = hasWarm
      ? {
          recordings: Number(warmCache.recordings) || 0,
          summaries: Number(warmCache.summaries) || 0,
          updatedAt: Number(warmCache.updatedAt),
        }
      : null;
    statsFetchInFlight = true;
    clearStatsWatchdog();
    const watchdogMs = includeSummaries ? 195000 : 90000;
    statsWatchdogTimer = setTimeout(() => {
      if (!statsFetchInFlight) return;
      statsFetchInFlight = false;
      warmStatsDuringFetch = null;
      if (hasWarm) {
        renderArchiveStrip(
          Number(warmCache.recordings) || 0,
          Number(warmCache.summaries) || 0,
          { cachedAt: warmCache.updatedAt, offline: true }
        );
        updateStatus(tr("stats.timeoutFootnote"), "error");
      } else {
        renderArchiveStrip(0, 0, {
          offline: true,
          phaseMessage: tr("stats.timeoutFootnote"),
        });
      }
      updateExportControls();
    }, watchdogMs);
    if (hasWarm) {
      renderArchiveStrip(
        Number(warmCache.recordings) || 0,
        Number(warmCache.summaries) || 0,
        { cachedAt: warmCache.updatedAt, loading: true }
      );
    } else {
      renderArchiveStrip(0, 0, {
        loading: true,
        phaseMessage: includeSummaries
          ? tr("stats.fullScan")
          : tr("stats.loadListSummaries"),
      });
    }
    updateExportControls();
    sendMessageToTabWithRecovery(
      tab,
      { action: "runLibraryStats", includeSummaries },
      (sendError, response) => {
        clearStatsWatchdog();
        statsFetchInFlight = false;
        warmStatsDuringFetch = null;
        if (sendError || !response?.success) {
          const msg =
            sendError?.message || response?.error || tr("stats.statsError");
          if (hasWarm) {
            renderArchiveStrip(
              Number(warmCache.recordings) || 0,
              Number(warmCache.summaries) || 0,
              { cachedAt: warmCache.updatedAt, offline: true }
            );
          } else {
            renderArchiveStrip(0, 0, {
              offline: true,
              phaseMessage: `${msg} ${tr("stats.retryPlaud")}`,
            });
          }
          updateExportControls();
          return;
        }
        const rec = Number(response.recordings) || 0;
        const rawSummaries = response.summaries;
        loadCachedLibraryStats((cached) => {
          persistLibraryStatsMerge(
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
          renderArchiveStrip(rec, renderSummaries, { cachedAt: Date.now() });
          updateExportControls();
        });
      }
    );
  }

  function startForegroundExport(exportMode) {
    getFocusedTab((tabError, tab) => {
      if (tabError) {
        updateStatus(
          tr("error.exportPrefix", { msg: tabError.message }),
          "error"
        );
        return;
      }
      ensureActiveTabHasUrl(tab, function (resolved) {
        if (!isPlaudTab(resolved)) {
          updateStatus(
            getPlaudTabHelpText(
              tr("actions.export", { mode: getExportModeLabel(exportMode) })
            ),
            "error"
          );
          return;
        }
        exportActionButtons.forEach((button) => {
          if (button) button.disabled = true;
        });
        sendMessageToTabWithRecovery(
          resolved,
          { action: "runExportAll", background: false, exportMode },
          (sendError, response) => {
            if (sendError) {
              updateStatus(
                tr("error.startExportFailed", { url: PLAUD_URL_HINT }),
                "error"
              );
              updateExportControls();
              return;
            }
            if (response && response.success) {
              foregroundExportBusy = true;
              updateStatus(
                tr("toast.exportStarted", {
                  mode: getExportModeLabel(exportMode),
                }),
                "info"
              );
            } else {
              updateStatus(
                tr("error.exportError", {
                  msg: response?.error || tr("error.unknown"),
                }),
                "error"
              );
            }
            updateExportControls();
          }
        );
      });
    });
  }

  function startCurrentPageExport(exportMode) {
    getFocusedTab((tabError, tab) => {
      if (tabError) {
        updateStatus(
          tr("error.exportPrefix", { msg: tabError.message }),
          "error"
        );
        return;
      }
      ensureActiveTabHasUrl(tab, function (resolved) {
        if (!isPlaudTab(resolved)) {
          updateStatus(
            getPlaudTabHelpText(
              tr("actions.exportCurrent", {
                mode: getExportModeLabel(exportMode),
              })
            ),
            "error"
          );
          return;
        }
        exportActionButtons.forEach((button) => {
          if (button) button.disabled = true;
        });
        sendMessageToTabWithRecovery(
          resolved,
          { action: "runExportCurrentPage", exportMode },
          (sendError, response) => {
            if (sendError) {
              const hint =
                sendError.message &&
                !sendError.message.includes("Receiving end does not exist") &&
                !sendError.message.includes("Could not establish connection")
                  ? ` (${sendError.message})`
                  : "";
              updateStatus(
                tr("error.connectPage", { hint: hint, url: PLAUD_URL_HINT }),
                "error"
              );
              updateExportControls();
              return;
            }
            if (response && response.success) {
              foregroundExportBusy = true;
              updateStatus(
                tr("toast.currentExportStarted", {
                  mode: getExportModeLabel(exportMode),
                }),
                "info"
              );
            } else {
              updateStatus(
                contentErrorMessage(response, "error.couldNotStartCurrent"),
                "error"
              );
            }
            updateExportControls();
          }
        );
      });
    });
  }

  function refreshLocalizedShell() {
    applyI18nToDocument();
    getFocusedTab((tabError, tab) => {
      if (tabError) {
        activeTabIsPlaud = false;
        if (readyPanel) readyPanel.hidden = true;
        if (offlinePanel) offlinePanel.hidden = false;
        if (tabStateBadge) {
          tabStateBadge.textContent = tr("badge.noTab");
          tabStateBadge.className = "badge badge--offline";
        }
        updateTabBadgeOpenPlaudAction();
        setRecordingPreview(null);
        updateExportControls();
        return;
      }
      ensureActiveTabHasUrl(tab, function (resolved) {
        setPlaudTabState(resolved);
        refreshSmartSyncStatus(resolved);
        pingContentBusyState(resolved, applyContentBusyFromPing);
        if (lastExportStatusData) {
          updateExportStatus(lastExportStatusData);
        }
        updateExportControls();
      });
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettingsSheet);
  }
  if (closeSheetBtn) {
    closeSheetBtn.addEventListener("click", closeSettingsSheet);
  }
  if (sheetBackdrop) {
    sheetBackdrop.addEventListener("click", closeSettingsSheet);
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && sheetOpen) closeSettingsSheet();
  });

  if (langRuBtn) {
    langRuBtn.addEventListener("click", function () {
      if (uiLocale === "ru") return;
      PlaudI18n.setLocale("ru", function () {
        uiLocale = "ru";
        refreshLocalizedShell();
      });
    });
  }
  if (langEnBtn) {
    langEnBtn.addEventListener("click", function () {
      if (uiLocale === "en") return;
      PlaudI18n.setLocale("en", function () {
        uiLocale = "en";
        refreshLocalizedShell();
      });
    });
  }

  function bindThemePreferenceButton(btn, pref) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (themePref === pref) return;
      PlaudI18n.setThemePreference(pref, function (saved) {
        themePref = saved;
        applyDocumentTheme();
        updateThemeToggleUi();
      });
    });
  }
  bindThemePreferenceButton(themeSystemBtn, "system");
  bindThemePreferenceButton(themeLightBtn, "light");
  bindThemePreferenceButton(themeDarkBtn, "dark");

  if (hasChromeExtensionApi && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "sync" || !changes[PlaudI18n.THEME_STORAGE_KEY]) return;
      var nv = changes[PlaudI18n.THEME_STORAGE_KEY].newValue;
      if (nv === "light" || nv === "dark" || nv === "system") {
        themePref = nv;
        applyDocumentTheme();
        updateThemeToggleUi();
      }
    });
  }

  if (tabStateBadge) {
    tabStateBadge.addEventListener("click", function () {
      if (tabStateBadge.classList.contains("badge--offline"))
        openPlaudWebSite();
    });
    tabStateBadge.addEventListener("keydown", function (ev) {
      if (!tabStateBadge.classList.contains("badge--offline")) return;
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      openPlaudWebSite();
    });
  }

  if (offlineOpenPlaudBtn) {
    offlineOpenPlaudBtn.addEventListener("click", openPlaudWebSite);
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      startCurrentPageExport(EXPORT_MODE_SUMMARY);
    });
  }

  if (statsRefreshBtn) {
    statsRefreshBtn.addEventListener("click", function () {
      getFocusedTab((tabError, tab) => {
        if (tabError || !tab) {
          updateStatus(tr("error.statsTab"), "error");
          return;
        }
        ensureActiveTabHasUrl(tab, function (resolved) {
          loadCachedLibraryStats(function (cached) {
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
            refreshLibraryStatsFromTab(resolved, true, warm);
          });
        });
      });
    });
  }

  if (syncFolderInput) {
    syncFolderInput.addEventListener("input", scheduleSyncFolderSave);
    syncFolderInput.addEventListener("change", scheduleSyncFolderSave);
  }

  if (syncModeBothBtn) {
    syncModeBothBtn.addEventListener("click", function () {
      if (selectedSyncMode === SYNC_MODE_BOTH) return;
      selectedSyncMode = SYNC_MODE_BOTH;
      updateSyncModeToggleUi();
      persistSyncMode(SYNC_MODE_BOTH);
    });
  }
  if (syncModeSummaryBtn) {
    syncModeSummaryBtn.addEventListener("click", function () {
      if (selectedSyncMode === SYNC_MODE_SUMMARY) return;
      selectedSyncMode = SYNC_MODE_SUMMARY;
      updateSyncModeToggleUi();
      persistSyncMode(SYNC_MODE_SUMMARY);
    });
  }

  if (exportModeBothBtn) {
    exportModeBothBtn.addEventListener("click", function () {
      if (selectedAdvancedExportMode === EXPORT_MODE_BOTH) return;
      selectedAdvancedExportMode = EXPORT_MODE_BOTH;
      updateAdvancedExportModeUi();
    });
  }
  if (exportModeAudioBtn) {
    exportModeAudioBtn.addEventListener("click", function () {
      if (selectedAdvancedExportMode === EXPORT_MODE_AUDIO) return;
      selectedAdvancedExportMode = EXPORT_MODE_AUDIO;
      updateAdvancedExportModeUi();
    });
  }

  if (openDownloadsBtn) {
    openDownloadsBtn.addEventListener("click", function () {
      sendRuntimeMessage({ action: "showDefaultDownloadsFolder" }, () => {});
    });
  }

  if (syncIcloudCmdEl) {
    syncIcloudCmdEl.textContent = ICLOUD_SYMLINK_COMMAND;
  }

  if (syncIcloudCopyBtn) {
    syncIcloudCopyBtn.addEventListener("click", function () {
      if (syncIcloudCopyResetTimer) {
        clearTimeout(syncIcloudCopyResetTimer);
        syncIcloudCopyResetTimer = null;
      }
      copyTextToClipboard(ICLOUD_SYMLINK_COMMAND).then(
        function () {
          syncIcloudCopyBtn.textContent = tr("sync.icloudTipCopied");
          syncIcloudCopyResetTimer = setTimeout(function () {
            syncIcloudCopyBtn.textContent = tr("sync.icloudTipCopy");
            syncIcloudCopyResetTimer = null;
          }, 2000);
        },
        function () {
          syncIcloudCopyBtn.textContent = tr("sync.icloudTipCopyFailed");
          syncIcloudCopyResetTimer = setTimeout(function () {
            syncIcloudCopyBtn.textContent = tr("sync.icloudTipCopy");
            syncIcloudCopyResetTimer = null;
          }, 2000);
        }
      );
    });
  }

  if (smartSyncBtn) {
    smartSyncBtn.addEventListener("click", function () {
      getFocusedTab((tabError, tab) => {
        if (tabError) {
          updateStatus(
            tr("sync.startError", { msg: tabError.message }),
            "error"
          );
          return;
        }
        ensureActiveTabHasUrl(tab, function (resolved) {
          if (!isPlaudTab(resolved)) {
            updateStatus(getPlaudTabHelpText(tr("actions.smartSync")), "error");
            return;
          }
          if (smartSyncActive || exportActive || foregroundExportBusy) {
            updateStatus(tr("sync.busy"), "info");
            return;
          }
          const syncSubdirectory =
            syncFolderInput?.value?.trim() || DEFAULT_SYNC_SUBDIRECTORY;
          smartSyncBtn.disabled = true;
          renderSmartSyncStatus({
            status: "running",
            processed: 0,
            total: 0,
            new: 0,
            updated: 0,
            skipped: 0,
            lastMessage: tr("sync.starting"),
          });
          sendRuntimeMessage(
            {
              action: "startSmartSync",
              tabId: resolved.id,
              syncSubdirectory,
              syncMode: selectedSyncMode,
            },
            (sendError, response) => {
              if (sendError || !response?.success) {
                smartSyncActive = false;
                currentSmartSyncTabId = null;
                renderSmartSyncStatus({
                  status: "error",
                  error:
                    response?.error ||
                    sendError?.message ||
                    tr("error.unknown"),
                });
                updateStatus(
                  tr("sync.startError", {
                    msg:
                      response?.error ||
                      sendError?.message ||
                      tr("error.unknown"),
                  }),
                  "error"
                );
              } else {
                smartSyncActive = true;
                currentSmartSyncTabId = resolved.id;
                updateStatus(tr("sync.started"), "success");
                startSmartSyncPolling();
              }
              updateExportControls();
            }
          );
        });
      });
    });
  }

  if (exportAllSummariesBtn) {
    exportAllSummariesBtn.addEventListener("click", function () {
      startForegroundExport(EXPORT_MODE_SUMMARY);
    });
  }

  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", function () {
      startForegroundExport(selectedAdvancedExportMode);
    });
  }

  if (exportCurrentBtn) {
    exportCurrentBtn.addEventListener("click", function () {
      startCurrentPageExport(selectedAdvancedExportMode);
    });
  }

  if (exportBgBtn) {
    exportBgBtn.addEventListener("click", function () {
      getFocusedTab((tabError, tab) => {
        if (tabError) {
          updateStatus(
            tr("error.bgExportFailed", { msg: tabError.message }),
            "error"
          );
          return;
        }
        ensureActiveTabHasUrl(tab, function (resolved) {
          if (!isPlaudTab(resolved)) {
            updateStatus(getPlaudTabHelpText(tr("actions.bgExport")), "error");
            return;
          }
          exportBgBtn.disabled = true;
          sendRuntimeMessage(
            {
              action: "startBackgroundExport",
              tabId: resolved.id,
              exportMode: selectedAdvancedExportMode,
            },
            (sendError, response) => {
              if (sendError) {
                updateStatus(
                  tr("error.bgStartFailed", { msg: sendError.message }),
                  "error"
                );
              } else if (response && response.success) {
                updateStatus(tr("error.bgStarted"), "success");
                exportActive = true;
                currentExportTabId = resolved.id;
                updateExportControls();
                updateActivityIndicators();
                startStatusPolling();
              } else {
                updateStatus(
                  tr("error.bgStartFailed", {
                    msg: response?.error || tr("error.unknown"),
                  }),
                  "error"
                );
              }
              updateExportControls();
            }
          );
        });
      });
    });
  }

  if (stopExportBtn) {
    stopExportBtn.addEventListener("click", function () {
      const stopTabId = currentExportTabId;
      getFocusedTab((tabError, tab) => {
        const tabId = stopTabId || tab?.id;
        if (tabError && !tabId) {
          updateStatus(
            tr("error.stopFailed", { msg: tabError.message }),
            "error"
          );
          return;
        }
        if (!tabId) {
          updateStatus(tr("error.stopNoTab"), "error");
          return;
        }
        sendRuntimeMessage(
          { action: "stopExport", tabId },
          (sendError, response) => {
            if (sendError) {
              updateStatus(
                tr("error.stopFailed", { msg: sendError.message }),
                "error"
              );
              return;
            }
            if (response && response.success) {
              updateStatus(tr("error.stopAfterFile"), "info");
              stopStatusPolling();
              exportActive = false;
              currentExportTabId = null;
              updateExportStatus(null);
              updateExportControls();
              updateActivityIndicators();
            } else {
              updateStatus(
                tr("error.stopFailedGeneric", {
                  msg: response?.error || tr("error.unknown"),
                }),
                "error"
              );
            }
          }
        );
      });
    });
  }

  function copyTextToClipboard(text) {
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
  }

  if (copyStatusBtn) {
    copyStatusBtn.addEventListener("click", function () {
      const text = statusEl.textContent || "";
      if (!text.trim()) return;
      copyTextToClipboard(text).then(
        function () {
          copyStatusBtn.textContent = tr("copy.copied");
          setTimeout(function () {
            copyStatusBtn.textContent = copyStatusBtnDefault;
          }, 2000);
        },
        function () {
          copyStatusBtn.textContent = tr("copy.failed");
          setTimeout(function () {
            copyStatusBtn.textContent = copyStatusBtnDefault;
          }, 2000);
        }
      );
    });
  }

  function updateStatus(message, type = "info") {
    if (statusClearTimer) {
      clearTimeout(statusClearTimer);
      statusClearTimer = null;
    }
    statusEl.textContent = message;
    statusEl.className = "status-line status-line--" + type;

    if (copyStatusBtn) {
      copyStatusBtn.hidden = type !== "error" || !message;
      copyStatusBtn.textContent = copyStatusBtnDefault;
    }

    if (type === "error" && message) return;

    statusClearTimer = setTimeout(function () {
      statusEl.textContent = "";
      statusEl.className = "status-line";
      statusClearTimer = null;
      if (copyStatusBtn) copyStatusBtn.hidden = true;
    }, 5000);
  }

  function stopStatusPolling() {
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
      statusPollingInterval = null;
    }
  }

  function checkExportStatus() {
    getFocusedTab((tabError, tab) => {
      if (tabError) {
        activeTabIsPlaud = false;
        if (readyPanel) readyPanel.hidden = true;
        if (offlinePanel) offlinePanel.hidden = false;
        if (tabStateBadge) {
          tabStateBadge.textContent = tr("badge.noTab");
          tabStateBadge.className = "badge badge--offline";
        }
        updateTabBadgeOpenPlaudAction();
        setRecordingPreview(null);
        updateExportControls();
        return;
      }

      ensureActiveTabHasUrl(tab, function (focusedResolved) {
        runAfterNextPaint(function () {
          setPlaudTabState(focusedResolved);
          refreshSmartSyncStatus(focusedResolved);
          pingContentBusyState(focusedResolved, applyContentBusyFromPing);

          const statusTabId =
            exportActive && currentExportTabId != null
              ? currentExportTabId
              : isPlaudTab(focusedResolved)
                ? focusedResolved.id
                : null;

          if (statusTabId == null) {
            sendRuntimeMessage(
              { action: "getAnyRunningExport" },
              function (sendErr, anyResp) {
                if (
                  !sendErr &&
                  anyResp?.success &&
                  anyResp.isRunning &&
                  anyResp.tabId != null
                ) {
                  exportActive = true;
                  currentExportTabId = anyResp.tabId;
                  exportPollTransientErrors = 0;
                  if (anyResp.exportData) {
                    updateExportStatus(anyResp.exportData);
                    startStatusPolling();
                  }
                  updateActivityIndicators();
                } else {
                  stopStatusPolling();
                  exportActive = false;
                  currentExportTabId = null;
                  exportPollTransientErrors = 0;
                  updateExportStatus(null);
                  updateActivityIndicators();
                }
                updateExportControls();
              }
            );
            return;
          }

          let exportStatusFinalized = false;
          let exportStatusFallbackTimer = null;

          function finalizeExportStatus(sendError, response) {
            if (exportStatusFinalized) return;
            exportStatusFinalized = true;
            if (exportStatusFallbackTimer !== null) {
              clearTimeout(exportStatusFallbackTimer);
              exportStatusFallbackTimer = null;
            }
            if (sendError) {
              updateExportControls();
              return;
            }
            if (response && response.success) {
              exportActive = response.isRunning;
              currentExportTabId = exportActive ? statusTabId : null;
              if (exportActive && response.exportData) {
                updateExportStatus(response.exportData);
                startStatusPolling();
              } else {
                stopStatusPolling();
                exportPollTransientErrors = 0;
                updateExportStatus(null);
              }
              updateActivityIndicators();
              updateExportControls();
            } else {
              updateExportControls();
            }
          }

          exportStatusFallbackTimer = setTimeout(function () {
            finalizeExportStatus(new Error("getExportStatus timeout"), null);
          }, 1200);

          sendRuntimeMessage(
            { action: "getExportStatus", tabId: statusTabId },
            function (sendError, response) {
              finalizeExportStatus(sendError, response);
            }
          );
        });
      });
    });
  }

  function updateExportStatus(data) {
    if (!exportStatusContainer) return;
    if (!data || data.status === "stopped") {
      lastExportStatusData = null;
      exportStatusContainer.innerHTML = "";
      delete exportStatusContainer.dataset.exportUiBuilt;
      exportStatusContainer.classList.remove("active");
      updateActivityIndicators();
      return;
    }
    lastExportStatusData = data;
    exportStatusContainer.classList.add("active");
    updateActivityIndicators();

    const startedAt = Number(data.startTime) || Date.now();
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000)
    );
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const timeString = tr("time.exportElapsed", { m: minutes, s: seconds });

    function finiteOr(value, fallback) {
      if (value === undefined || value === null || value === "")
        return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    const processed = finiteOr(data.filesProcessed, 0);
    const audio = finiteOr(data.audioExported, 0);
    const errored = finiteOr(data.filesErrored, 0);
    const summaries = finiteOr(data.summariesExported, 0);
    const summaryErrors = finiteOr(data.summaryErrors, 0);
    const total = finiteOr(data.filesTotal, 0);
    const progress =
      total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    const processedLabel =
      total > 0 ? `${processed}/${total}` : String(processed);

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
    if (heading) heading.textContent = tr("status.exportRunning");
    const bar = exportStatusContainer.querySelector(".progress-bar");
    if (bar) bar.style.width = `${progress}%`;

    const lblAudio = exportStatusContainer.querySelector(".export-lbl-audio");
    const lblSummary = exportStatusContainer.querySelector(
      ".export-lbl-summary"
    );
    const lblErrors = exportStatusContainer.querySelector(".export-lbl-errors");
    const lblElapsed = exportStatusContainer.querySelector(
      ".export-lbl-elapsed"
    );
    if (lblAudio) lblAudio.textContent = tr("status.audio");
    if (lblSummary) lblSummary.textContent = tr("status.summary");
    if (lblErrors) lblErrors.textContent = tr("status.errors");
    if (lblElapsed) lblElapsed.textContent = tr("status.elapsed");

    const valAudio = exportStatusContainer.querySelector(".export-val-audio");
    const valSummary = exportStatusContainer.querySelector(
      ".export-val-summary"
    );
    const valErrors = exportStatusContainer.querySelector(".export-val-errors");
    const valElapsed = exportStatusContainer.querySelector(
      ".export-val-elapsed"
    );
    if (valAudio) valAudio.textContent = String(audio);
    if (valSummary) valSummary.textContent = String(summaries);
    if (valErrors) valErrors.textContent = String(errored + summaryErrors);
    if (valElapsed) valElapsed.textContent = timeString;

    const note = exportStatusContainer.querySelector(".export-records-note");
    if (note) {
      note.textContent = tr("status.recordsProcessed", {
        label: processedLabel,
      });
    }
  }

  function updateExportControls() {
    const blockExportActions =
      exportActive || foregroundExportBusy || smartSyncActive;
    if (blockExportActions) {
      exportActionButtons.forEach((button) => {
        if (button) button.disabled = true;
      });
    } else {
      exportActionButtons.forEach((button) => {
        if (button) button.disabled = !activeTabIsPlaud;
      });
    }
    if (stopExportBtn) {
      if (exportActive) {
        stopExportBtn.disabled = false;
        stopExportBtn.hidden = false;
      } else {
        stopExportBtn.disabled = true;
        stopExportBtn.hidden = true;
      }
    }
    if (statsRefreshBtn) {
      statsRefreshBtn.disabled =
        statsFetchInFlight ||
        exportActive ||
        foregroundExportBusy ||
        smartSyncActive ||
        !activeTabIsPlaud;
    }
    if (syncFolderInput) {
      syncFolderInput.disabled = smartSyncActive;
    }
    if (openDownloadsBtn) {
      openDownloadsBtn.disabled = false;
    }
    updateDownloadBusyUi();
    updateActivityIndicators();
  }

  function startStatusPolling() {
    exportPollTransientErrors = 0;
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
    }
    statusPollingInterval = setInterval(() => {
      getFocusedTab((tabError, tab) => {
        const tabId = currentExportTabId != null ? currentExportTabId : tab?.id;
        if (tabError && !tabId) return;
        sendRuntimeMessage(
          { action: "getExportStatus", tabId },
          (sendError, response) => {
            if (sendError) {
              exportPollTransientErrors += 1;
              if (exportPollTransientErrors >= 4) {
                stopStatusPolling();
                exportActive = false;
                currentExportTabId = null;
                exportPollTransientErrors = 0;
                updateExportStatus(null);
                updateExportControls();
              }
              return;
            }
            exportPollTransientErrors = 0;
            if (response && response.success) {
              exportActive = response.isRunning;
              if (exportActive && response.exportData) {
                updateExportStatus(response.exportData);
              } else {
                stopStatusPolling();
                exportActive = false;
                currentExportTabId = null;
                updateExportControls();
                updateExportStatus(null);
              }
            }
          }
        );
      });
    }, 2000);
  }

  if (hasChromeExtensionApi) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "foregroundExportComplete") {
        foregroundExportBusy = false;
        const result = request.data;
        if (result?.error) {
          updateStatus(formatForegroundExportResult(result), "error");
        } else if (result) {
          const hasErrors =
            (Number(result.filesErrored) || 0) +
              (Number(result.summaryErrors) || 0) >
            0;
          updateStatus(
            formatForegroundExportResult(result),
            hasErrors ? "error" : "success"
          );
        }
        updateExportControls();
        return;
      }
      if (request.action === "libraryStatsProgress") {
        handleLibraryStatsProgress(request.data);
      }
      if (request.action === "smartSyncStatusUpdate") {
        if (request.tabId != null) currentSmartSyncTabId = request.tabId;
        smartSyncActive = request.data?.status === "running";
        renderSmartSyncStatus(request.data);
        if (!smartSyncActive) stopSmartSyncPolling();
        updateExportControls();
      }
    });
  }

  updateAdvancedExportModeUi();
  updateSyncModeToggleUi();
  checkExportStatus();
});
