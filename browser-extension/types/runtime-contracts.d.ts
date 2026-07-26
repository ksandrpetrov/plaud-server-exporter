type PlaudExportMode = "both" | "audio" | "summary";
type PlaudSyncMode = "both" | "summary";
type PopupThemePreference = "system" | "light" | "dark";
type PopupLocale = "ru" | "en";

interface PlaudRecording extends Record<string, unknown> {
  id: string;
  title: string;
  raw: Record<string, unknown>;
  folderIds?: string[];
  folderSegment?: string;
}

interface PlaudSummaryExport {
  markdown: string;
  title?: string;
}

interface PlaudBrowserSession {
  apiBase: string;
  authHeader: string;
  userAuthHeader: string;
  workspaceAuthHeader: string;
  workspaceId: string;
  sortBy: string;
  tokenSource?: string;
}

interface ExportStats {
  status?: "running" | "stopped" | "completed" | "error";
  exportMode: PlaudExportMode;
  filesProcessed: number;
  filesErrored: number;
  filesSkipped: number;
  filesTotal?: number;
  audioExported: number;
  audioErrors: number;
  summariesExported: number;
  summariesSkipped: number;
  summaryErrors: number;
  startTime: number;
  endTime?: number;
  duration?: number;
  currentTitle?: string;
  error?: string;
}

interface SmartSyncStats {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  new: number;
  updated: number;
  skipped: number;
  alreadySynced: number;
  errors: number;
  audioDownloaded: number;
  summariesDownloaded: number;
  startedAt: number;
  finishedAt: number | null;
  currentTitle: string;
  lastMessage: string;
  error?: string;
  records?: number;
  lastSyncedAt?: string;
}

interface SyncIndexRecord extends Record<string, unknown> {
  stableId?: string;
  fingerprint?: string;
  title?: string;
  folderSegment?: string;
  audioPath?: string;
  summaryPath?: string;
  summaryPaths?: string[];
  lastDownloadIds?: number[];
}

interface ExtensionSyncIndex {
  v: number;
  records: Record<string, SyncIndexRecord>;
  settings: {
    storageMode?: string;
    syncSubdirectory?: string;
    syncMode?: PlaudSyncMode;
    syncNotificationsEnabled?: boolean;
  };
  updatedAt: string;
}

interface SyncCandidate extends Record<string, unknown> {
  stableId: string;
  identityKind: string;
  identityConfidence: string;
  fingerprint: string;
  title: string;
  sourceUrl: string;
  summaryHash: string;
  audioSignature: string;
  normalizedFilename: string;
  audioNormalizedFilename: string;
  createdAt: unknown;
  updatedAt: unknown;
  folderSegment: string;
  audioUrl?: string;
}

interface LibraryStatsNote {
  countExplanation?: string;
}

interface LibraryStatsResult {
  recordings: number;
  summaries: number;
  libraryStatsNote?: LibraryStatsNote;
}

interface ContentRuntimeState {
  isBackgroundExporting: boolean;
  shouldStopExport: boolean;
  exportRunLock: boolean;
  libraryStatsLock: boolean;
  smartSyncLock: boolean;
  runExportAll:
    | ((
        backgroundMode?: boolean,
        options?: {
          exportMode?: PlaudExportMode;
          singleFile?: Pick<PlaudRecording, "id" | "title">;
          tr?: (key: string, params?: Record<string, unknown>) => string;
        }
      ) => Promise<ExportStats>)
    | null;
  runLibraryStats:
    | ((options?: {
        includeSummaries?: boolean;
        timeoutMs?: number;
        onProgress?: (progress: {
          phase: "list" | "summaries";
          current: number;
          total: number;
        }) => void;
      }) => Promise<LibraryStatsResult>)
    | null;
  runSmartSync:
    | ((options?: {
        syncSubdirectory?: string;
        syncMode?: PlaudSyncMode;
        onProgress?: (stats: SmartSyncStats) => void;
      }) => Promise<SmartSyncStats>)
    | null;
  resolveCurrentRecording: (() => PlaudRecording | null) | null;
  initError: Error | null;
  initPromise: Promise<void> | null;
}

interface DownloadRequest {
  action?: "downloadPlaudFile";
  url?: string;
  textContent?: string;
  mimeType?: string;
  filename?: string;
  conflictAction?: chrome.downloads.FilenameConflictAction;
  timeoutMs?: number;
}

interface DownloadResponse {
  success: true;
  downloadId: number;
  filename: string;
  conflictAction: chrome.downloads.FilenameConflictAction;
  transport?: "page-anchor";
}

type RuntimeMessage =
  | {
      action: "startBackgroundExport";
      tabId: number;
      exportMode: PlaudExportMode;
    }
  | {
      action: "startSmartSync";
      tabId: number;
      syncSubdirectory?: string;
      syncMode?: PlaudSyncMode;
    }
  | { action: "stopExport"; tabId: number }
  | { action: "getExportStatus"; tabId?: number }
  | { action: "getAnyRunningExport" }
  | { action: "getSmartSyncStatus"; tabId: number }
  | { action: "getSyncSettings" }
  | { action: "setSyncSubdirectory"; syncSubdirectory: string }
  | { action: "setSyncMode"; syncMode: PlaudSyncMode }
  | { action: "showDefaultDownloadsFolder" }
  | ({ action: "downloadPlaudFile" } & DownloadRequest)
  | {
      action: "runExportAll";
      background: boolean;
      exportMode: PlaudExportMode;
    }
  | { action: "runExportCurrentPage"; exportMode: PlaudExportMode }
  | { action: "runLibraryStats"; includeSummaries: boolean }
  | {
      action: "runSmartSync";
      syncSubdirectory?: string;
      syncMode?: PlaudSyncMode;
    }
  | { action: "plaudExportPing" }
  | { action: "stopExportProcess" }
  | { action: "checkShouldStop" }
  | { action: "exportComplete"; data: ExportStats }
  | {
      action: "foregroundExportComplete";
      tabId: number;
      data?: ExportStats;
    }
  | {
      action: "libraryStatsProgress";
      data: { phase: "list" | "summaries"; current: number; total: number };
    }
  | { action: "smartSyncProgress"; data: SmartSyncStats }
  | { action: "smartSyncComplete"; data: SmartSyncStats }
  | {
      action: "exportProgressUpdate";
      data: ExportStats & { currentTitle: string };
    }
  | {
      action: "smartSyncStatusUpdate";
      tabId?: number;
      data: SmartSyncStats;
    };

interface RuntimeResponse {
  success?: boolean;
  message?: string;
  error?: string;
  errorKey?: string;
  alive?: boolean;
  backgroundExporting?: boolean;
  exportRunLock?: boolean;
  libraryStatsLock?: boolean;
  smartSyncLock?: boolean;
  currentRecording?: PlaudRecording | null;
  shouldStop?: boolean;
  isRunning?: boolean;
  tabId?: number;
  exportData?: ExportStats;
  syncData?: SmartSyncStats;
  settings?: {
    syncSubdirectory?: string;
    syncMode?: PlaudSyncMode;
  };
  summary?: Partial<SmartSyncStats>;
  recordings?: number;
  summaries?: number;
  libraryStatsNote?: LibraryStatsNote;
}

interface PlaudI18nApi {
  STORAGE_KEY: string;
  THEME_STORAGE_KEY: string;
  t(locale: PopupLocale, key: string, params?: Record<string, unknown>): string;
  getDefaultLocaleFromNavigator(): PopupLocale;
  getEffectiveLocale(): Promise<PopupLocale>;
  setLocale(
    locale: PopupLocale,
    callback?: (locale: PopupLocale) => void
  ): void;
  getEffectiveThemePreference(): Promise<PopupThemePreference>;
  setThemePreference(
    preference: PopupThemePreference,
    callback?: (preference: PopupThemePreference) => void
  ): void;
}

interface PopupElements {
  downloadBtn: HTMLButtonElement | null;
  downloadBtnLabel: HTMLElement | null;
  downloadBtnSpinner: HTMLElement | null;
  exportAllSummariesBtn: HTMLButtonElement | null;
  exportAllBtn: HTMLButtonElement | null;
  exportCurrentBtn: HTMLButtonElement | null;
  exportBgBtn: HTMLButtonElement | null;
  stopExportBtn: HTMLButtonElement | null;
  exportModeBothBtn: HTMLButtonElement | null;
  exportModeAudioBtn: HTMLButtonElement | null;
  readyPanel: HTMLElement | null;
  offlinePanel: HTMLElement | null;
  offlineOpenPlaudBtn: HTMLButtonElement | null;
  smartSyncBtn: HTMLButtonElement | null;
  openDownloadsBtn: HTMLButtonElement | null;
  syncFolderInput: HTMLInputElement | null;
  syncModeBothBtn: HTMLButtonElement | null;
  syncModeSummaryBtn: HTMLButtonElement | null;
  syncStatusEl: HTMLElement | null;
  syncIcloudCmdEl: HTMLElement | null;
  syncIcloudCopyBtn: HTMLButtonElement | null;
  statusEl: HTMLElement;
  copyStatusBtn: HTMLButtonElement | null;
  exportStatusContainer: HTMLElement | null;
  tabStateBadge: HTMLElement | null;
  recordingTitle: HTMLElement | null;
  recordingSubtitle: HTMLElement | null;
  archiveStrip: HTMLElement | null;
  archiveLine: HTMLElement | null;
  statsRefreshBtn: HTMLButtonElement | null;
  langRuBtn: HTMLButtonElement | null;
  langEnBtn: HTMLButtonElement | null;
  themeSystemBtn: HTMLButtonElement | null;
  themeLightBtn: HTMLButtonElement | null;
  themeDarkBtn: HTMLButtonElement | null;
  settingsBtn: HTMLButtonElement | null;
  closeSheetBtn: HTMLButtonElement | null;
  layout: HTMLElement | null;
  settingsSheet: HTMLElement | null;
  sheetBackdrop: HTMLElement | null;
  settingsActivityDot: HTMLElement | null;
  mainExportHint: HTMLElement | null;
}

interface PopupLibraryStatsCache {
  recordings: number;
  summaries: number;
  updatedAt: number;
}

type PopupMessageCallback = (
  error: Error | null,
  response: RuntimeResponse | null
) => void;

interface PopupContext {
  uiLocale: PopupLocale;
  themePref: PopupThemePreference;
  exportActive: boolean;
  foregroundExportBusy: boolean;
  activeTabIsPlaud: boolean;
  smartSyncActive: boolean;
  statsFetchInFlight: boolean;
  sheetOpen: boolean;
  sheetInitialized: boolean;
  currentExportTabId: number | null;
  currentSmartSyncTabId: number | null;
  lastExportStatusData: ExportStats | null;
  lastSmartSyncData: Partial<SmartSyncStats> | null;
  selectedSyncMode: PlaudSyncMode;
  selectedAdvancedExportMode: PlaudExportMode;
  exportPollTransientErrors: number;
  warmStatsDuringFetch: PopupLibraryStatsCache | null;
  copyStatusBtnDefault: string;
  syncIcloudCopyResetTimer: number | null;
  syncFolderSaveTimer: number | null;
  statusPollingInterval: number | null;
  foregroundBusyPollInterval: number | null;
  smartSyncPollingInterval: number | null;
  statusClearTimer: number | null;
  statsWatchdogTimer: number | null;
  PLAUD_HOSTS: string[];
  PLAUD_URL_HINT: string;
  EXPORT_MODE_BOTH: "both";
  EXPORT_MODE_AUDIO: "audio";
  EXPORT_MODE_SUMMARY: "summary";
  SYNC_MODE_BOTH: "both";
  SYNC_MODE_SUMMARY: "summary";
  ICLOUD_SYMLINK_COMMAND: string;
  DEFAULT_SYNC_SUBDIRECTORY: string;
  LIBRARY_STATS_STORAGE_KEY: string;
  hasChromeExtensionApi: boolean;
  els: PopupElements;
  exportActionButtons: Array<HTMLButtonElement | null>;

  tr?(key: string, params?: Record<string, unknown>): string;
  contentErrorMessage?(
    response: RuntimeResponse | null | undefined,
    fallbackKey: string
  ): string;
  getExportModeLabel?(mode: string): string;
  formatForegroundExportResult?(data?: ExportStats | null): string;
  formatShortRelative?(timestamp: number): string;
  formatSyncLine?(data?: Partial<SmartSyncStats> | null): string;
  getPlaudTabHelpText?(actionText: string): string;
  isPlaudTab?(tab?: chrome.tabs.Tab | null): boolean;
  isMissingReceivingEndError?(error?: Error | null): boolean;
  copyTextToClipboard?(text: string): Promise<void>;

  getFocusedTab?(
    callback: (error: Error | null, tab: chrome.tabs.Tab | null) => void
  ): void;
  ensureActiveTabHasUrl?(
    tab: chrome.tabs.Tab,
    callback: (tab: chrome.tabs.Tab) => void
  ): void;
  sendMessageToTab?(
    tabId: number,
    message: RuntimeMessage,
    callback: PopupMessageCallback
  ): void;
  sendRuntimeMessage?(
    message: RuntimeMessage,
    callback: PopupMessageCallback
  ): void;
  injectContentScript?(
    tabId: number,
    callback: (error: Error | null) => void
  ): void;
  retrySendMessageToTab?(
    tabId: number,
    message: RuntimeMessage,
    attemptsRemaining: number,
    callback: PopupMessageCallback
  ): void;
  sendMessageToTabWithRecovery?(
    tab: chrome.tabs.Tab,
    message: RuntimeMessage,
    callback: PopupMessageCallback
  ): void;
  runAfterNextPaint?(callback: FrameRequestCallback): void;
  loadCachedLibraryStats?(
    callback: (stats: PopupLibraryStatsCache | null) => void
  ): void;
  renderArchiveStrip?(
    recordings: number,
    summaries: number | null | undefined,
    options?: {
      cachedAt?: number;
      loading?: boolean;
      offline?: boolean;
      phaseMessage?: string;
    }
  ): void;
  persistLibraryStatsMerge?(
    recordings: number,
    summaries?: number | null
  ): void;
  refreshLibraryStatsFromTab?(
    tab: chrome.tabs.Tab,
    includeSummaries: boolean,
    warmCache?: PopupLibraryStatsCache | null
  ): void;
  handleLibraryStatsProgress?(data: {
    phase: "list" | "summaries";
    current: number;
    total: number;
  }): void;
  setRecordingPreview?(recording?: PlaudRecording | null): void;
  pingContentBusyState?(
    tab: chrome.tabs.Tab,
    callback: (response: RuntimeResponse | null) => void
  ): void;
  applyContentBusyFromPing?(response: RuntimeResponse | null): void;
  renderSmartSyncStatus?(data?: Partial<SmartSyncStats> | null): void;
  refreshSmartSyncStatus?(tab?: chrome.tabs.Tab | null): void;
  updateStatus?(message: string, type?: "info" | "success" | "error"): void;
  updateExportStatus?(data?: ExportStats | null): void;
  startForegroundExport?(mode: PlaudExportMode): void;
  startCurrentPageExport?(mode: PlaudExportMode): void;
  checkExportStatus?(): void;
  bindThemePreferenceButton?(
    button: HTMLButtonElement | null,
    preference: PopupThemePreference
  ): void;

  applyDocumentTheme?(): void;
  updateThemeToggleUi?(): void;
  applyI18nToDocument?(): void;
  refreshLocalizedShell?(): void;
  bindLangButtons?(): void;
  updateActivityIndicators?(): void;
  updateAdvancedExportModeUi?(): void;
  updateDownloadBusyUi?(): void;
  updateExportControls?(): void;
  stopStatusPolling?(): void;
  stopForegroundBusyPolling?(): void;
  syncForegroundBusyPolling?(): void;
  startStatusPolling?(): void;
  bindExportUi?(): void;
  attachRuntimeMessageListener?(): void;
  clearStatsWatchdog?(): void;
  bindStatsUi?(): void;
  updateSyncModeToggleUi?(): void;
  persistSyncMode?(mode: PlaudSyncMode): void;
  scheduleSyncFolderSave?(): void;
  loadSyncSettings?(): void;
  stopSmartSyncPolling?(): void;
  startSmartSyncPolling?(): void;
  bindSyncUi?(): void;
  refreshRecordingPreview?(tab?: chrome.tabs.Tab | null): void;
  setPlaudTabState?(tab: chrome.tabs.Tab): void;
  updateTabBadgeOpenPlaudAction?(): void;
  openPlaudWebSite?(): void;
  openSettingsSheet?(): void;
  closeSettingsSheet?(): void;
  lazyInitSheet?(): void;
  bindTabUi?(): void;
}

interface PopupExportMetrics {
  processed: number;
  audio: number;
  errored: number;
  summaries: number;
  summaryErrors: number;
  total: number;
  progress: number;
  processedLabel: string;
}

interface PopupNamespace {
  createState?(): PopupContext;
  initTheme?(context: PopupContext): void;
  initI18n?(context: PopupContext): void;
  initMessaging?(context: PopupContext): void;
  initStats?(context: PopupContext): void;
  initSync?(context: PopupContext): void;
  initExport?(context: PopupContext): void;
  initTabs?(context: PopupContext): void;
  applyExportControlStates?(context: PopupContext): void;
  computeExportStatusMetrics?(data: ExportStats): PopupExportMetrics;
  formatExportElapsed?(
    startedAt: number,
    tr: (key: string, params?: Record<string, unknown>) => string
  ): string;
  formatForegroundExportResult?(
    data: ExportStats | null | undefined,
    context: PopupContext
  ): string;
  handleForegroundExportSendResult?(
    context: PopupContext,
    exportMode: PlaudExportMode,
    error: Error | null,
    response: RuntimeResponse | null | undefined
  ): void;
  handleCurrentPageExportSendResult?(
    context: PopupContext,
    exportMode: PlaudExportMode,
    error: Error | null,
    response: RuntimeResponse | null | undefined
  ): void;
  resolveExportStatusTabId?(params: {
    exportActive: boolean;
    currentExportTabId: number | null;
    focusedTab: chrome.tabs.Tab | null;
    isPlaudTab: (tab: chrome.tabs.Tab) => boolean;
  }): number | null;
  shouldResumeFromAnyRunningExport?(
    response: RuntimeResponse | null | undefined
  ): boolean;
  shouldStopExportPollingAfterErrors?(transientErrors: number): boolean;
  createExportStatusFinalizer?(params: {
    onFinalize: PopupMessageCallback;
    timeoutMs?: number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
  }): {
    finalize: PopupMessageCallback;
    cancel(): void;
  };
  EXPORT_STATUS_TIMEOUT_MS?: number;
  MAX_EXPORT_POLL_TRANSIENT_ERRORS?: number;
}

declare var PlaudI18n: PlaudI18nApi | undefined;
declare var PlaudPopup: PopupNamespace | undefined;

interface Window {
  __plaudExporterContentLoaded?: boolean;
  PlaudI18n?: PlaudI18nApi;
  PlaudPopup?: PopupNamespace;
}
