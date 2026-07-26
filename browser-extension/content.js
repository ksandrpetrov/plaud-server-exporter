/**
 * Loads export modules and sets up message listeners for export actions.
 */
if (window.__plaudExporterContentLoaded) {
  console.log("Расширение Plaud уже загружено.");
} else {
  window.__plaudExporterContentLoaded = true;

  let contentLocale = globalThis.PlaudI18n
    ? globalThis.PlaudI18n.getDefaultLocaleFromNavigator()
    : "ru";
  if (globalThis.PlaudI18n) {
    globalThis.PlaudI18n.getEffectiveLocale().then(function (loc) {
      contentLocale = loc;
    });
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "sync" || !changes[globalThis.PlaudI18n.STORAGE_KEY])
          return;
        var nv = changes[globalThis.PlaudI18n.STORAGE_KEY].newValue;
        if (nv === "ru" || nv === "en") contentLocale = nv;
      });
    }
  }

  function contentTr(key, params) {
    var I = globalThis.PlaudI18n;
    if (!I) return key;
    return I.t(contentLocale, key, params);
  }

  /** @type {ContentRuntimeState} */
  const state = {
    isBackgroundExporting: false,
    shouldStopExport: false,
    exportRunLock: false,
    libraryStatsLock: false,
    smartSyncLock: false,
    runExportAll: null,
    runLibraryStats: null,
    runSmartSync: null,
    resolveCurrentRecording: null,
    initError: null,
    initPromise: null,
  };

  state.initPromise = (async () => {
    try {
      console.log("Загрузка модулей…");
      const audioExportModule = await import(
        chrome.runtime.getURL("features/audioExport/audioExport.js")
      );
      const resolverModule = await import(
        chrome.runtime.getURL(
          "features/audioExport/currentRecordingResolver.js"
        )
      );
      const handlersModule = await import(
        chrome.runtime.getURL("content/contentHandlers.js")
      );
      state.runExportAll = audioExportModule.runExportAll;
      state.runLibraryStats = audioExportModule.runLibraryStats;
      state.runSmartSync = audioExportModule.runSmartSync;
      state.resolveCurrentRecording = resolverModule.resolveCurrentRecording;
      handlersModule.registerContentMessageHandlers(state, contentTr);
    } catch (error) {
      state.initError = error;
      console.error("❌ Не удалось загрузить модули расширения:", error);
      throw error;
    }
  })();

  state.initPromise.catch(() => {
    window.__plaudExporterContentLoaded = false;
  });

  window.addEventListener("beforeunload", function (e) {
    if (state.isBackgroundExporting) {
      e.preventDefault();
      e.returnValue = contentTr("error.beforeunloadExport");
      return e.returnValue;
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (state.isBackgroundExporting && document.visibilityState === "hidden") {
      console.log("Страница скрыта, фоновый экспорт продолжается");
    }
  });
}
