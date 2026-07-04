(function (global) {
  "use strict";

  global.PlaudPopup = global.PlaudPopup || {};

  try {
    document.documentElement.dataset.themeEffective = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
      ? "dark"
      : "light";
  } catch {
    /* ignore */
  }

  global.PlaudPopup.createState = function createState() {
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
    const layout = document.querySelector(".layout");
    const settingsSheet = document.getElementById("settingsSheet");
    const sheetBackdrop = document.getElementById("sheetBackdrop");
    const settingsActivityDot = document.getElementById("settingsActivityDot");
    const mainExportHint = document.getElementById("mainExportHint");

    const hasChromeExtensionApi =
      typeof chrome !== "undefined" &&
      chrome.tabs &&
      chrome.runtime &&
      chrome.scripting;

    return {
      uiLocale: "ru",
      /** @type {"system" | "light" | "dark"} */
      themePref: "system",
      exportActive: false,
      foregroundExportBusy: false,
      activeTabIsPlaud: false,
      smartSyncActive: false,
      statsFetchInFlight: false,
      sheetOpen: false,
      sheetInitialized: false,
      currentExportTabId: null,
      currentSmartSyncTabId: null,
      lastExportStatusData: null,
      lastSmartSyncData: null,
      selectedSyncMode: "both",
      selectedAdvancedExportMode: "both",
      exportPollTransientErrors: 0,
      warmStatsDuringFetch: null,
      copyStatusBtnDefault: "",
      syncIcloudCopyResetTimer: null,
      syncFolderSaveTimer: null,
      statusPollingInterval: null,
      smartSyncPollingInterval: null,
      statusClearTimer: null,
      statsWatchdogTimer: null,
      PLAUD_HOSTS: ["app.plaud.ai", "web.plaud.ai"],
      PLAUD_URL_HINT: "https://web.plaud.ai",
      EXPORT_MODE_BOTH: "both",
      EXPORT_MODE_AUDIO: "audio",
      EXPORT_MODE_SUMMARY: "summary",
      SYNC_MODE_BOTH: "both",
      SYNC_MODE_SUMMARY: "summary",
      ICLOUD_SYMLINK_COMMAND:
        'ln -s "$HOME/Library/Mobile Documents/com~apple~CloudDocs" "$HOME/Downloads/iCloud"',
      DEFAULT_SYNC_SUBDIRECTORY: "PlaudExports/Sync",
      LIBRARY_STATS_STORAGE_KEY: "plaudExporterLibraryStats",
      hasChromeExtensionApi,
      els: {
        downloadBtn,
        downloadBtnLabel,
        downloadBtnSpinner,
        exportAllSummariesBtn,
        exportAllBtn,
        exportCurrentBtn,
        exportBgBtn,
        stopExportBtn,
        exportModeBothBtn,
        exportModeAudioBtn,
        readyPanel,
        offlinePanel,
        offlineOpenPlaudBtn,
        smartSyncBtn,
        openDownloadsBtn,
        syncFolderInput,
        syncModeBothBtn,
        syncModeSummaryBtn,
        syncStatusEl,
        syncIcloudCmdEl,
        syncIcloudCopyBtn,
        statusEl,
        copyStatusBtn,
        exportStatusContainer,
        tabStateBadge,
        recordingTitle,
        recordingSubtitle,
        archiveStrip,
        archiveLine,
        statsRefreshBtn,
        langRuBtn,
        langEnBtn,
        themeSystemBtn,
        themeLightBtn,
        themeDarkBtn,
        settingsBtn,
        closeSheetBtn,
        layout,
        settingsSheet,
        sheetBackdrop,
        settingsActivityDot,
        mainExportHint,
      },
      exportActionButtons: [
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
      ],
    };
  };

  /**
   * @param {ReturnType<typeof global.PlaudPopup.createState>} ctx
   */
  global.PlaudPopup.initTheme = function initTheme(ctx) {
    const prefersDarkMq = window.matchMedia("(prefers-color-scheme: dark)");

    function resolveThemeEffectiveDark() {
      if (ctx.themePref === "dark") return true;
      if (ctx.themePref === "light") return false;
      return prefersDarkMq.matches;
    }

    ctx.applyDocumentTheme = function applyDocumentTheme() {
      document.documentElement.dataset.themeEffective =
        resolveThemeEffectiveDark() ? "dark" : "light";
    };

    ctx.updateThemeToggleUi = function updateThemeToggleUi() {
      const { themeSystemBtn, themeLightBtn, themeDarkBtn } = ctx.els;
      const sys = ctx.themePref === "system";
      [themeSystemBtn, themeLightBtn, themeDarkBtn].forEach(function (btn) {
        if (!btn) return;
        btn.classList.remove("toggle-group__item--active");
        btn.setAttribute("aria-pressed", "false");
      });
      if (themeSystemBtn && sys) {
        themeSystemBtn.classList.add("toggle-group__item--active");
        themeSystemBtn.setAttribute("aria-pressed", "true");
      }
      if (themeLightBtn && ctx.themePref === "light") {
        themeLightBtn.classList.add("toggle-group__item--active");
        themeLightBtn.setAttribute("aria-pressed", "true");
      }
      if (themeDarkBtn && ctx.themePref === "dark") {
        themeDarkBtn.classList.add("toggle-group__item--active");
        themeDarkBtn.setAttribute("aria-pressed", "true");
      }
    };

    ctx.bindThemePreferenceButton = function bindThemePreferenceButton(
      btn,
      pref
    ) {
      if (!btn) return;
      const PlaudI18n = globalThis.PlaudI18n;
      btn.addEventListener("click", function () {
        if (ctx.themePref === pref) return;
        PlaudI18n.setThemePreference(pref, function (saved) {
          ctx.themePref = saved;
          ctx.applyDocumentTheme();
          ctx.updateThemeToggleUi();
        });
      });
    };

    ctx.applyDocumentTheme();
    prefersDarkMq.addEventListener("change", function () {
      if (ctx.themePref === "system") ctx.applyDocumentTheme();
    });
  };
})(window);
