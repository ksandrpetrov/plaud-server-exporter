import assert from "node:assert/strict";
import test from "node:test";

import { registerContentMessageHandlers } from "../content/contentHandlers.js";

function installContentChromeMock() {
  let listener = null;
  const sent = [];
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(value) {
          listener = value;
        },
      },
      sendMessage(message) {
        sent.push(message);
        return Promise.resolve({ success: true });
      },
    },
  };
  return {
    sent,
    dispatch(request, sender = { tab: { id: 5 } }) {
      const responses = [];
      const asyncResponse = listener(request, sender, (response) =>
        responses.push(response)
      );
      return { responses, asyncResponse };
    },
  };
}

function makeState(patch = {}) {
  return {
    isBackgroundExporting: false,
    shouldStopExport: false,
    exportRunLock: false,
    libraryStatsLock: false,
    smartSyncLock: false,
    runExportAll: async (_background, options) => ({
      exportMode: options.exportMode,
      filesProcessed: 1,
      filesErrored: 0,
      filesSkipped: 0,
      audioExported: 1,
      audioErrors: 0,
      summariesExported: 1,
      summariesSkipped: 0,
      summaryErrors: 0,
      startTime: Date.now(),
    }),
    runLibraryStats: async () => ({ recordings: 2, summaries: 1 }),
    runSmartSync: async (options) => {
      const result = {
        status: "completed",
        total: 1,
        processed: 1,
        new: 1,
        updated: 0,
        skipped: 0,
        alreadySynced: 0,
        errors: 0,
        audioDownloaded: 1,
        summariesDownloaded: 1,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        currentTitle: "Review",
        lastMessage: "Done",
      };
      options.onProgress?.({ ...result, status: "running" });
      return result;
    },
    resolveCurrentRecording: () => ({
      id: "abcdef0123456789abcdef0123456789",
      title: "Review",
      raw: { file_id: "abcdef0123456789abcdef0123456789" },
    }),
    initError: null,
    initPromise: Promise.resolve(),
    ...patch,
  };
}

const tr = (key) => key;
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("content handlers expose ping, stop and stop-check state", () => {
  const chromeMock = installContentChromeMock();
  const state = makeState();
  registerContentMessageHandlers(state, tr);

  const ping = chromeMock.dispatch({ action: "plaudExportPing" });
  assert.equal(ping.asyncResponse, false);
  assert.equal(ping.responses[0].alive, true);
  assert.equal(ping.responses[0].currentRecording.title, "Review");

  chromeMock.dispatch({ action: "stopExportProcess" });
  assert.equal(state.shouldStopExport, true);
  const stop = chromeMock.dispatch({ action: "checkShouldStop" });
  assert.equal(stop.responses[0].shouldStop, true);
});

test("content handlers fail init safely and keep all operations locked", async () => {
  const chromeMock = installContentChromeMock();
  const state = makeState({
    initError: new Error("module init failed"),
    initPromise: Promise.reject(new Error("module init failed")),
  });
  registerContentMessageHandlers(state, tr);

  const run = chromeMock.dispatch({
    action: "runExportAll",
    background: false,
    exportMode: "both",
  });
  assert.equal(run.asyncResponse, true);
  await flush();
  assert.equal(run.responses[0].success, false);
  assert.match(run.responses[0].error, /module init failed/);

  state.initPromise = Promise.resolve();
  state.initError = null;
  state.exportRunLock = true;
  const exportBusy = chromeMock.dispatch({
    action: "runExportAll",
    background: false,
    exportMode: "both",
  });
  const statsBusy = chromeMock.dispatch({
    action: "runLibraryStats",
    includeSummaries: true,
  });
  const syncBusy = chromeMock.dispatch({
    action: "runSmartSync",
    syncMode: "both",
  });
  await flush();
  assert.equal(exportBusy.responses[0].success, false);
  assert.equal(statsBusy.responses[0].success, false);
  assert.equal(syncBusy.responses[0].success, false);
});

test("content handlers complete foreground and background exports", async () => {
  const chromeMock = installContentChromeMock();
  const state = makeState();
  registerContentMessageHandlers(state, tr);

  const foreground = chromeMock.dispatch({
    action: "runExportCurrentPage",
    exportMode: "summary",
  });
  await flush();
  assert.equal(foreground.responses[0].success, true);
  assert.equal(state.exportRunLock, false);
  assert.equal(
    chromeMock.sent.some(
      (message) => message.action === "foregroundExportComplete"
    ),
    true
  );

  const background = chromeMock.dispatch({
    action: "runExportAll",
    background: true,
    exportMode: "audio",
  });
  await flush();
  assert.equal(background.responses[0].success, true);
  assert.equal(state.isBackgroundExporting, false);
  assert.equal(
    chromeMock.sent.some((message) => message.action === "exportComplete"),
    true
  );
});

test("content handlers report a missing current recording without export", async () => {
  const chromeMock = installContentChromeMock();
  const state = makeState({ resolveCurrentRecording: () => null });
  let runs = 0;
  state.runExportAll = async () => {
    runs++;
    throw new Error("must not run");
  };
  registerContentMessageHandlers(state, tr);

  const result = chromeMock.dispatch({
    action: "runExportCurrentPage",
    exportMode: "both",
  });
  await flush();
  assert.equal(result.responses[0].success, false);
  assert.equal(result.responses[0].errorKey, "currentRecordingNotFound");
  assert.equal(runs, 0);
});

test("content handlers stream library stats and smart sync", async () => {
  const chromeMock = installContentChromeMock();
  const state = makeState();
  registerContentMessageHandlers(state, tr);

  const stats = chromeMock.dispatch({
    action: "runLibraryStats",
    includeSummaries: true,
  });
  await flush();
  assert.equal(stats.responses[0].success, true);
  assert.equal(stats.responses[0].recordings, 2);
  assert.equal(state.libraryStatsLock, false);

  const sync = chromeMock.dispatch({
    action: "runSmartSync",
    syncSubdirectory: "PlaudExports/Sync",
    syncMode: "both",
  });
  await flush();
  assert.equal(sync.responses[0].success, true);
  assert.equal(state.smartSyncLock, false);
  assert.equal(
    chromeMock.sent.some((message) => message.action === "smartSyncProgress"),
    true
  );
  assert.equal(
    chromeMock.sent.some((message) => message.action === "smartSyncComplete"),
    true
  );
});
