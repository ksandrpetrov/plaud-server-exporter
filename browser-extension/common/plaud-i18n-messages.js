/* global globalThis, chrome, navigator */
/**
 * Shared UI strings (ru/en) + helpers for popup and service worker.
 * Loaded via <script> in popup and importScripts in background.js.
 */
(function () {
  var STORAGE_KEY = "plaudExporterUiLocale";
  var THEME_STORAGE_KEY = "plaudExporterTheme";

  var MESSAGES = {
    ru: {
      page: { title: "Экспорт Plaud" },
      brand: { title: "Plaud" },
      main: {
        download: "Скачать саммари",
        subtitle: "AI-саммари · Markdown",
        noRecording: "Откройте саммари записи на Plaud Web",
      },
      sheet: {
        title: "Ещё",
        open: "Настройки и расширенные действия",
        close: "Закрыть",
        summaries: "Все саммари",
        archive: "Архив",
        advanced: "Расширенный экспорт",
        preferences: "Настройки",
      },
      hero: {
        downloadAll: "Скачать все саммари",
        downloadCurrent: "Только текущая запись",
      },
      archive: {
        line: "{recordings} записей · {summaries} саммари",
        loading: "Загрузка архива…",
        offline: "Кэш: {recordings} записей · {summaries} саммари · {time}",
      },
      badge: {
        checking: "Проверка…",
        onPlaudWeb: "Вы на Plaud Web",
        openPlaudWeb: "Открыть Plaud Web",
        noTab: "Нет вкладки",
      },
      stats: {
        refresh: "Обновить",
        refreshTitle: "Полный пересчёт с саммари (может занять время)",
        phase: {
          list: "Загружаем список записей…",
          summariesLine: "Сканируем саммари… {current}/{total}",
        },
        fullScan: "Полное сканирование AI-заметок по каждой записи…",
        loadListSummaries: "Загружаем список записей и считаем саммари…",
        timeoutFootnote:
          "Запрос статистики занял слишком много времени. Обновите вкладку Plaud (F5) и попробуйте снова или нажмите «Обновить» позже.",
        statsError: "Не удалось получить статистику.",
        retryPlaud: "Обновите страницу Plaud и попробуйте снова.",
        waitLogin:
          "Откройте вкладку Plaud Web и войдите — здесь появятся цифры.",
      },
      time: {
        justNow: "только что",
        minAgo: "{n} мин назад",
        hourAgo: "{n} ч назад",
        dayAgo: "{n} дн назад",
        exportElapsed: "{m} мин {s} с",
      },
      offline: {
        title: "Plaud-страница не найдена",
        lead: "Экспорт и синхронизация доступны только на вкладке Plaud Web.",
      },
      export: {
        subtitle: "Разовая выгрузка в Downloads",
        modeGroupAria: "Режим экспорта",
        allRecordings: "Все записи",
        currentRecording: "Текущая запись",
      },
      sync: {
        title: "Синхронизация в папку",
        lead: "Умная подгрузка без дублей",
        modeBoth: "Аудио и саммари",
        modeSummary: "Только саммари",
        modeGroupAria: "Режим синхронизации",
        folderLabel: "Папка внутри Downloads",
        folderHelp:
          "Chrome разрешает расширению задавать подпапку в Downloads, а не произвольный системный путь.",
        icloudTipSummary: "Хочу сохранять в iCloud или другую папку",
        icloudTipLead:
          "Расширение пишет только внутрь Downloads. На macOS можно один раз создать симлинк, и файлы будут попадать в iCloud (или любую другую папку) автоматически.",
        icloudTipStep1: "Откройте Терминал и выполните команду:",
        icloudTipCopy: "Скопировать",
        icloudTipCopied: "Скопировано",
        icloudTipCopyFailed: "Не удалось",
        icloudTipFootnote:
          "После этого в поле выше укажите путь через созданный симлинк (например, iCloud/PlaudExports/Sync) и сохраните.",
        openDownloads: "Открыть Downloads",
        start: "Синхронизировать",
        starting: "Подготавливаем синхронизацию…",
        started: "Синхронизация запущена.",
        busy: "Дождитесь завершения текущей операции.",
        settingsUnavailable: "Настройки синхронизации пока недоступны.",
        startError: "Не удалось запустить синхронизацию: {msg}",
        idleLine: "Синхронизация ещё не запускалась.",
        indexLine: "В индексе: {n}. Последняя синхронизация: {time}.",
        runningLine:
          "Синхронизация: {scope}. Новых {n}, обновлено {u}, пропущено {s}.",
        doneLine:
          "Готово: новых {n}, обновлено {u}, пропущено {s}, ошибок {e}.",
        errorLine: "Ошибка синхронизации: {msg}",
        alreadyRunning: "Синхронизация уже выполняется на этой вкладке.",
        rejected: "Скрипт страницы отклонил запуск синхронизации.",
        notifyStartedTitle: "Синхронизация запущена",
        notifyStartedMessage: "Файлы будут сохранены в Downloads/{folder}.",
        notifyDoneTitle: "Синхронизация завершена",
        notifyDoneMessage: "Новых: {n}, обновлено: {u}, пропущено: {s}.",
        notifyErrorTitle: "Синхронизация не завершена",
        notifyErrorMessage: "Проверьте вкладку Plaud и повторите попытку.",
        tabClosedMessage: "Вкладка Plaud закрыта — синхронизация остановлена.",
        staleMessage:
          "Синхронизация не присылала прогресс слишком долго. Обновите вкладку Plaud и запустите снова.",
      },
      btn: {
        audioAndSummary: "Аудио и саммари",
        audioOnly: "Только аудио",
        exportBackground: "Экспортировать в фоне",
        stop: "Стоп",
        copyError: "Копировать текст ошибки",
        openPlaud: "Открыть Plaud Web",
      },
      footer: { language: "Язык", theme: "Тема" },
      lang: { ru: "RU", en: "EN" },
      theme: {
        system: "Авто",
        light: "Свет",
        dark: "Темно",
        systemTitle: "Как в системе",
        lightTitle: "Светлая тема",
        darkTitle: "Тёмная тема",
      },
      status: {
        exportRunning: "Идёт экспорт",
        audio: "Аудио",
        summary: "Саммари",
        errors: "Ошибки",
        elapsed: "Прошло",
        recordsProcessed: "Обработано записей: {label}",
      },
      error: {
        apiUnavailable: "API расширения Chrome недоступно",
        noActiveTab: "Активная вкладка не найдена",
        exportPrefix: "Ошибка экспорта: {msg}",
        startExportFailed:
          "Не удалось начать экспорт. Откройте {url} и повторите с этой вкладки.",
        exportError: 'Ошибка экспорта: {msg}',
        unknown: "Неизвестная ошибка",
        connectPage:
          "Не удалось связаться со страницей{hint}. Откройте {url}, обновите вкладку (F5) и повторите.",
        couldNotStartCurrent: "Не удалось начать экспорт текущей записи.",
        currentRecordingNotFound:
          "Не удалось определить запись. Откройте отдельное саммари записи на Plaud Web — в адресе должен быть идентификатор файла.",
        statsTab: "Не удалось определить вкладку для статистики.",
        waitExport: "Дождитесь окончания экспорта перед обновлением статистики.",
        bgExportFailed: "Не удалось запустить фоновый экспорт: {msg}",
        bgStarted: "Фоновый экспорт запущен.",
        bgStartFailed: "Не удалось запустить фоновый экспорт: {msg}",
        stopFailed: "Остановка не удалась: {msg}",
        stopNoTab: "Остановка не удалась: не найдена вкладка экспорта.",
        stopAfterFile: "Экспорт остановится после завершения текущего файла.",
        beforeunloadExport: "Идёт экспорт. Покинуть страницу?",
        stopFailedGeneric: "Остановка не удалась: {msg}",
        contentExportModuleLoadFailed:
          "Не удалось загрузить модуль экспорта. Обновите страницу Plaud Web.",
        contentExportModuleNotReady:
          "Модуль экспорта не готов. Обновите страницу.",
        contentExportLockBusy:
          "Экспорт уже выполняется на этой вкладке. Дождитесь завершения или остановите процесс.",
        contentExportStarting: "Запуск экспорта…",
        contentModuleLoadFailed:
          "Не удалось загрузить модуль. Обновите страницу Plaud Web.",
        contentStatsModuleNotReady:
          "Модуль статистики не готов. Обновите страницу.",
        contentStatsLockBusy:
          "Подсчёт архива уже выполняется на этой вкладке.",
        contentSyncModuleLoadFailed:
          "Не удалось загрузить модуль синхронизации. Обновите страницу Plaud Web.",
        contentSyncModuleNotReady:
          "Модуль синхронизации не готов. Обновите страницу.",
        contentSyncStarting: "Синхронизация запущена…",
      },
      help: {
        openRepeat: "Откройте {url} и повторите: {action}.",
      },
      exportMode: {
        audio: "аудио",
        summary: "саммари",
        both: "аудио и саммари",
        shortAudio: "Аудио",
        shortSummary: "Саммари",
        shortBoth: "Аудио и саммари",
      },
      actions: {
        statsRefresh: "обновление статистики архива",
        export: "экспорт {mode}",
        exportCurrent: "экспорт текущей записи ({mode})",
        bgExport: "фоновый экспорт аудио и саммари",
        smartSync: "фоновая синхронизация",
      },
      copy: { copied: "Скопировано", failed: "Не удалось скопировать" },
      toast: {
        exportStarted: "Запущен экспорт: {mode}.",
        currentExportStarted: "Запущен экспорт текущей записи: {mode}.",
        exportDoneGeneric: "Экспорт завершён.",
        exportDoneSummary: "Готово: саммари {n}, ошибок {e}.",
        exportDoneAudio: "Готово: аудио {n}, ошибок {e}.",
        exportDoneBoth: "Готово: аудио {audio}, саммари {summaries}, ошибок {e}.",
      },
      bg: {
        stopTitle: "Экспорт остановлен",
        stopMessage: "Процесс экспорта остановлен.",
        progressTitle: "Прогресс экспорта",
        progressMessage: "Обработано файлов: {n}.",
        completeTitle: "{mode} — экспорт завершён",
        completeMessage:
          "Аудио: {audio}, саммари: {summary}. Сбоев записей: {errors}.",
        badTabId: "Некорректный идентификатор вкладки.",
        unknownAction: "Неизвестное действие сообщения",
        pageNotResponding: "Скрипт страницы не отвечает.",
        exportRejected: "Скрипт страницы отклонил запуск экспорта.",
        startedTitle: "{mode} — экспорт запущен",
        startedMessage:
          "Экспорт выполняется в фоне. Можно переключаться на другие вкладки.",
        startedSuccess: "Фоновый экспорт запущен",
        noDownloadId: "Chrome не вернул идентификатор загрузки.",
        downloadTimeout: "Загрузка {id} превысила время ожидания.",
        downloadInterrupted: "Загрузка {id} прервана.",
        downloadsUnsupported:
          "API chrome.downloads недоступен (например, Safari). Скачивание выполняется на странице Plaud.",
        noUrl: "Не указан URL для загрузки.",
        stallTitle: "Экспорт, возможно, завис",
        stallMessage:
          "Нет обновлений экспорта на вкладке {tabId} более 2 минут. Проверьте вкладку с Plaud.",
        tabClosedTitle: "Экспорт остановлен",
        tabClosedMessage: "Вкладка закрыта — экспорт прерван.",
        exportAlreadyRunning:
          "На этой вкладке уже идёт фоновый экспорт. Дождитесь завершения или нажмите «Стоп».",
      },
    },
    en: {
      page: { title: "Plaud Export" },
      brand: { title: "Plaud" },
      main: {
        download: "Download summary",
        subtitle: "AI summary · Markdown",
        noRecording: "Open a recording's summary on Plaud Web",
      },
      sheet: {
        title: "More",
        open: "Settings and advanced actions",
        close: "Close",
        summaries: "All summaries",
        archive: "Archive",
        advanced: "Advanced export",
        preferences: "Preferences",
      },
      hero: {
        downloadAll: "Download all summaries",
        downloadCurrent: "Current recording only",
      },
      archive: {
        line: "{recordings} recordings · {summaries} summaries",
        loading: "Loading archive…",
        offline: "Cache: {recordings} recordings · {summaries} summaries · {time}",
      },
      badge: {
        checking: "Checking…",
        onPlaudWeb: "You're on Plaud Web",
        openPlaudWeb: "Open Plaud Web",
        noTab: "No tab",
      },
      stats: {
        refresh: "Refresh",
        refreshTitle: "Full recount including summaries (may take a while)",
        phase: {
          list: "Loading recording list…",
          summariesLine: "Scanning summaries… {current}/{total}",
        },
        fullScan: "Full scan of AI notes for every recording…",
        loadListSummaries: "Loading recordings and counting summaries…",
        timeoutFootnote:
          "Statistics took too long. Refresh the Plaud tab (F5) and try again, or tap Refresh later.",
        statsError: "Could not load statistics.",
        retryPlaud: "Refresh the Plaud page and try again.",
        waitLogin:
          "Open the Plaud Web tab and sign in — numbers will appear here.",
      },
      time: {
        justNow: "just now",
        minAgo: "{n} min ago",
        hourAgo: "{n} h ago",
        dayAgo: "{n} d ago",
        exportElapsed: "{m} min {s} s",
      },
      offline: {
        title: "Plaud page not found",
        lead: "Export and sync actions are available only on a Plaud Web tab.",
      },
      export: {
        subtitle: "One-time download to Downloads",
        modeGroupAria: "Export mode",
        allRecordings: "All recordings",
        currentRecording: "Current recording",
      },
      sync: {
        title: "Sync to folder",
        lead: "Smart backfill without duplicates",
        modeBoth: "Audio and summaries",
        modeSummary: "Summaries only",
        modeGroupAria: "Sync mode",
        folderLabel: "Folder inside Downloads",
        folderHelp:
          "Chrome lets extensions target a subfolder in Downloads, not an arbitrary system path.",
        icloudTipSummary: "I want to save into iCloud or another folder",
        icloudTipLead:
          "The extension can only write inside Downloads. On macOS, create a one-time symlink and files will land in iCloud (or any other folder) automatically.",
        icloudTipStep1: "Open Terminal and run:",
        icloudTipCopy: "Copy",
        icloudTipCopied: "Copied",
        icloudTipCopyFailed: "Failed",
        icloudTipFootnote:
          "Then point the field above at a path through the symlink (e.g. iCloud/PlaudExports/Sync) and save.",
        openDownloads: "Open Downloads",
        start: "Sync now",
        starting: "Preparing sync…",
        started: "Sync started.",
        busy: "Wait for the current operation to finish.",
        settingsUnavailable: "Sync settings are not available yet.",
        startError: "Could not start sync: {msg}",
        idleLine: "Sync has not run yet.",
        indexLine: "Indexed: {n}. Last sync: {time}.",
        runningLine:
          "Syncing: {scope}. New {n}, updated {u}, skipped {s}.",
        doneLine:
          "Done: new {n}, updated {u}, skipped {s}, errors {e}.",
        errorLine: "Sync error: {msg}",
        alreadyRunning: "Sync is already running on this tab.",
        rejected: "The page script rejected starting sync.",
        notifyStartedTitle: "Sync started",
        notifyStartedMessage: "Files will be saved to Downloads/{folder}.",
        notifyDoneTitle: "Sync complete",
        notifyDoneMessage: "New: {n}, updated: {u}, skipped: {s}.",
        notifyErrorTitle: "Sync did not complete",
        notifyErrorMessage: "Check the Plaud tab and try again.",
        tabClosedMessage: "Plaud tab closed — sync stopped.",
        staleMessage:
          "Sync has not reported progress for too long. Refresh the Plaud tab and start again.",
      },
      btn: {
        audioAndSummary: "Audio and summaries",
        audioOnly: "Audio only",
        exportBackground: "Export in background",
        stop: "Stop",
        copyError: "Copy error text",
        openPlaud: "Open Plaud Web",
      },
      footer: { language: "Language", theme: "Theme" },
      lang: { ru: "RU", en: "EN" },
      theme: {
        system: "Auto",
        light: "Light",
        dark: "Dark",
        systemTitle: "Match system",
        lightTitle: "Light theme",
        darkTitle: "Dark theme",
      },
      status: {
        exportRunning: "Export running",
        audio: "Audio",
        summary: "Summaries",
        errors: "Errors",
        elapsed: "Elapsed",
        recordsProcessed: "Recordings processed: {label}",
      },
      error: {
        apiUnavailable: "Chrome extension API is unavailable",
        noActiveTab: "No active tab found",
        exportPrefix: "Export error: {msg}",
        startExportFailed:
          "Could not start export. Open {url} and try again from that tab.",
        exportError: "Export error: {msg}",
        unknown: "Unknown error",
        connectPage:
          "Could not reach the page{hint}. Open {url}, refresh (F5), and try again.",
        couldNotStartCurrent: "Could not start exporting the current recording.",
        currentRecordingNotFound:
          "Could not detect the recording. Open the recording's summary page on Plaud Web — the file ID must be in the URL.",
        statsTab: "Could not determine the tab for statistics.",
        waitExport: "Wait for export to finish before refreshing statistics.",
        bgExportFailed: "Could not start background export: {msg}",
        bgStarted: "Background export started.",
        bgStartFailed: "Could not start background export: {msg}",
        stopFailed: "Stop failed: {msg}",
        stopNoTab: "Stop failed: export tab not found.",
        stopAfterFile: "Export will stop after the current file finishes.",
        beforeunloadExport: "Export in progress. Leave this page?",
        stopFailedGeneric: "Stop failed: {msg}",
        contentExportModuleLoadFailed:
          "Could not load the export module. Refresh the Plaud Web page.",
        contentExportModuleNotReady:
          "Export module is not ready. Refresh the page.",
        contentExportLockBusy:
          "Export is already running on this tab. Wait for it to finish or stop it.",
        contentExportStarting: "Starting export…",
        contentModuleLoadFailed:
          "Could not load the module. Refresh the Plaud Web page.",
        contentStatsModuleNotReady:
          "Statistics module is not ready. Refresh the page.",
        contentStatsLockBusy:
          "Library stats are already running on this tab.",
        contentSyncModuleLoadFailed:
          "Could not load the sync module. Refresh the Plaud Web page.",
        contentSyncModuleNotReady:
          "Sync module is not ready. Refresh the page.",
        contentSyncStarting: "Sync started…",
      },
      help: {
        openRepeat: "Open {url} and try again: {action}.",
      },
      exportMode: {
        audio: "audio",
        summary: "summaries",
        both: "audio and summaries",
        shortAudio: "Audio",
        shortSummary: "Summaries",
        shortBoth: "Audio and summaries",
      },
      actions: {
        statsRefresh: "refresh archive statistics",
        export: "export {mode}",
        exportCurrent: "export current recording ({mode})",
        bgExport: "background export of audio and summaries",
        smartSync: "background sync",
      },
      copy: { copied: "Copied", failed: "Could not copy" },
      toast: {
        exportStarted: "Export started: {mode}.",
        currentExportStarted: "Current recording export started: {mode}.",
        exportDoneGeneric: "Export finished.",
        exportDoneSummary: "Done: {n} summaries, {e} errors.",
        exportDoneAudio: "Done: {n} audio files, {e} errors.",
        exportDoneBoth:
          "Done: {audio} audio, {summaries} summaries, {e} errors.",
      },
      bg: {
        stopTitle: "Export stopped",
        stopMessage: "The export process was stopped.",
        progressTitle: "Export progress",
        progressMessage: "Files processed: {n}.",
        completeTitle: "{mode} — export finished",
        completeMessage:
          "Audio: {audio}, summaries: {summary}. File errors: {errors}.",
        badTabId: "Invalid tab id.",
        unknownAction: "Unknown message action",
        pageNotResponding: "Page script is not responding.",
        exportRejected: "Page script rejected starting the export.",
        startedTitle: "{mode} — export started",
        startedMessage:
          "Export runs in the background. You can switch to other tabs.",
        startedSuccess: "Background export started",
        noDownloadId: "Chrome did not return a download id.",
        downloadTimeout: "Download {id} timed out.",
        downloadInterrupted: "Download {id} was interrupted.",
        downloadsUnsupported:
          "chrome.downloads is unavailable (e.g. Safari). Download from the Plaud page instead.",
        noUrl: "No URL specified for download.",
        stallTitle: "Export may be stuck",
        stallMessage:
          "No export updates on tab {tabId} for over 2 minutes. Check the Plaud tab.",
        tabClosedTitle: "Export stopped",
        tabClosedMessage: "Tab closed — export aborted.",
        exportAlreadyRunning:
          "A background export is already running on this tab. Wait for it to finish or press Stop.",
      },
    },
  };

  function getByPath(obj, path) {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function t(locale, key, params) {
    var dict = MESSAGES[locale] || MESSAGES.en;
    var str = getByPath(dict, key);
    if (str == null || typeof str !== "string") {
      str = getByPath(MESSAGES.en, key) || key;
    }
    if (!params) return str;
    return String(str).replace(/\{(\w+)\}/g, function (_m, name) {
      return params[name] != null ? String(params[name]) : "{" + name + "}";
    });
  }

  function getDefaultLocaleFromNavigator() {
    var lang =
      (typeof navigator !== "undefined" &&
        (navigator.language || (navigator.languages && navigator.languages[0]))) ||
      "en";
    return String(lang).toLowerCase().indexOf("ru") === 0 ? "ru" : "en";
  }

  function getEffectiveLocalePromise() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.sync
    ) {
      return Promise.resolve(getDefaultLocaleFromNavigator());
    }
    return new Promise(function (resolve) {
      chrome.storage.sync.get([STORAGE_KEY], function (result) {
        if (chrome.runtime.lastError) {
          resolve(getDefaultLocaleFromNavigator());
          return;
        }
        var v = result[STORAGE_KEY];
        if (v === "ru" || v === "en") {
          resolve(v);
          return;
        }
        resolve(getDefaultLocaleFromNavigator());
      });
    });
  }

  function getEffectiveThemePreferencePromise() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.sync
    ) {
      return Promise.resolve("system");
    }
    return new Promise(function (resolve) {
      chrome.storage.sync.get([THEME_STORAGE_KEY], function (result) {
        if (chrome.runtime.lastError) {
          resolve("system");
          return;
        }
        var v = result[THEME_STORAGE_KEY];
        if (v === "light" || v === "dark" || v === "system") {
          resolve(v);
          return;
        }
        resolve("system");
      });
    });
  }

  function setThemePreference(pref, callback) {
    var p =
      pref === "light" || pref === "dark" || pref === "system"
        ? pref
        : "system";
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
      if (callback) callback(p);
      return;
    }
    var patch = {};
    patch[THEME_STORAGE_KEY] = p;
    chrome.storage.sync.set(patch, function () {
      if (callback) callback(p);
    });
  }

  function setLocale(locale, callback) {
    var loc =
      locale === "ru" || locale === "en"
        ? locale
        : getDefaultLocaleFromNavigator();
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
      if (callback) callback(loc);
      return;
    }
    var patch = {};
    patch[STORAGE_KEY] = loc;
    chrome.storage.sync.set(patch, function () {
      if (callback) callback(loc);
    });
  }

  globalThis.PlaudI18n = {
    STORAGE_KEY: STORAGE_KEY,
    THEME_STORAGE_KEY: THEME_STORAGE_KEY,
    t: t,
    getDefaultLocaleFromNavigator: getDefaultLocaleFromNavigator,
    getEffectiveLocale: getEffectiveLocalePromise,
    setLocale: setLocale,
    getEffectiveThemePreference: getEffectiveThemePreferencePromise,
    setThemePreference: setThemePreference,
  };
})();
