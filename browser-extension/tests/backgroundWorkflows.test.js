import assert from "node:assert/strict";
import test from "node:test";

import {
  activeExports,
  activeTabIds,
  resetExportState,
  stopFlags,
} from "../background/exportStateStore.js";
import {
  startBackgroundExport,
  verifyExportTabAlive,
} from "../background/exportOrchestrator.js";
import { createExportHandlers } from "../background/handlers/exportHandlers.js";
import { createSmartSyncHandlers } from "../background/handlers/smartSyncHandlers.js";
import {
  activeSmartSyncs,
  activeSmartSyncTabIds,
  resetSmartSyncState,
} from "../background/smartSyncStateStore.js";
import {
  startSmartSync,
  summarizeSyncIndex,
} from "../background/smartSyncOrchestrator.js";

function installBackgroundChromeMock() {
  const calls = {
    runtimeMessages: [],
    tabMessages: [],
    notifications: [],
    sessionWrites: [],
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message) {
        calls.runtimeMessages.push(message);
        return Promise.resolve({ success: true });
      },
    },
    tabs: {
      sendMessage(tabId, message, callback) {
        calls.tabMessages.push({ tabId, message });
        callback?.({ success: true, alive: true });
        return Promise.resolve({ success: true, alive: true });
      },
      get(tabId) {
        return Promise.resolve({ id: tabId, autoDiscardable: true });
      },
      update() {
        return Promise.resolve();
      },
    },
    scripting: {
      executeScript(_options, callback) {
        callback();
      },
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({});
        },
        set(_values, callback) {
          callback?.();
        },
      },
      session: {
        get(_keys, callback) {
          callback({});
        },
        set(value) {
          calls.sessionWrites.push(value);
        },
      },
    },
    notifications: {
      create(options) {
        calls.notifications.push(options);
      },
    },
  };
  return calls;
}

function exportDeps(response = { success: true }) {
  return {
    sendRunExportMessageWithRecovery: async () => response,
    persistExportStateToSession: () => {},
    createSyncNotification: () => {},
    keepTabAlive: () => {},
  };
}

function smartSyncDeps(response = { success: true }) {
  return {
    patchSyncSettings: async () => {},
    persistSmartSyncStateToSession: () => {},
    getTab: async (tabId) => ({ id: tabId, autoDiscardable: true }),
    updateTab: async () => {},
    sendRunSmartSyncMessageWithRecovery: async () => response,
    createSyncNotification: () => {},
  };
}

test("background export starts, rejects duplicates and rolls back failures", async () => {
  installBackgroundChromeMock();
  resetExportState();

  const result = await startBackgroundExport(10, "audio", exportDeps());
  assert.equal(result.success, true);
  assert.equal(activeTabIds.has(10), true);
  assert.equal(activeExports[10].exportMode, "audio");
  assert.equal(activeExports[10].status, "running");

  await assert.rejects(
    startBackgroundExport(10, "audio", exportDeps()),
    /bg.exportAlreadyRunning|already/i
  );

  resetExportState();
  await assert.rejects(
    startBackgroundExport(
      11,
      "both",
      exportDeps({ success: false, error: "content rejected" })
    ),
    /content rejected/
  );
  assert.equal(activeTabIds.has(11), false);
  assert.equal(activeExports[11], undefined);
});

test("verifyExportTabAlive maps content responses and failures", async () => {
  installBackgroundChromeMock();
  assert.equal(await verifyExportTabAlive(12), true);
  globalThis.chrome.runtime.lastError = { message: "tab missing" };
  assert.equal(await verifyExportTabAlive(12), false);
  globalThis.chrome.runtime.lastError = null;
});

test("background export reinjects content after a missing receiver", async () => {
  const calls = installBackgroundChromeMock();
  resetExportState();
  let attempts = 0;
  let injections = 0;
  globalThis.chrome.tabs.sendMessage = (_tabId, _message, callback) => {
    attempts++;
    if (attempts === 1) {
      globalThis.chrome.runtime.lastError = {
        message:
          "Could not establish connection. Receiving end does not exist.",
      };
      callback(undefined);
      globalThis.chrome.runtime.lastError = null;
      return;
    }
    callback({ success: true });
  };
  globalThis.chrome.scripting.executeScript = (_options, callback) => {
    injections++;
    callback();
  };

  const result = await startBackgroundExport(13, "both", {
    persistExportStateToSession: () => {},
    createSyncNotification: () => {},
    keepTabAlive: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(attempts, 2);
  assert.equal(injections, 1);
  assert.equal(calls.notifications.length, 0);
});

test("smart sync starts, rejects duplicates, summarizes and records failures", async () => {
  installBackgroundChromeMock();
  resetSmartSyncState();

  const result = await startSmartSync(
    20,
    "../Unsafe/Team",
    "summary",
    smartSyncDeps()
  );
  assert.equal(result.success, true);
  assert.equal(activeSmartSyncTabIds.has(20), true);
  assert.equal(activeSmartSyncs[20].status, "running");
  assert.equal(activeSmartSyncs[20].syncSubdirectory.includes(".."), false);

  await assert.rejects(
    startSmartSync(20, "Team", "both", smartSyncDeps()),
    /sync.alreadyRunning|already/i
  );

  const summary = summarizeSyncIndex({
    records: {
      a: { lastSyncedAt: "2026-01-01T00:00:00.000Z" },
      b: { lastSyncedAt: "2026-02-01T00:00:00.000Z" },
    },
  });
  assert.deepEqual(summary, {
    records: 2,
    lastSyncedAt: "2026-02-01T00:00:00.000Z",
  });

  resetSmartSyncState();
  await assert.rejects(
    startSmartSync(
      21,
      "Team",
      "both",
      smartSyncDeps({ success: false, error: "sync rejected" })
    ),
    /sync rejected/
  );
  assert.equal(activeSmartSyncTabIds.has(21), false);
  assert.equal(activeSmartSyncs[21].status, "error");
});

test("export handlers cover stop, progress, complete and foreground relay", async () => {
  const calls = installBackgroundChromeMock();
  resetExportState();
  const handlers = createExportHandlers(() => {});
  const responses = [];
  const reply = (response) => responses.push(response);

  handlers.startBackgroundExport({ tabId: "bad" }, {}, reply);
  assert.equal(responses.at(-1).success, false);

  await startBackgroundExport(30, "both", exportDeps());
  handlers.exportProgressUpdate(
    { data: { filesProcessed: 10, audioExported: 8 } },
    { tab: { id: 30 } },
    reply
  );
  assert.equal(activeExports[30].filesProcessed, 10);
  assert.equal(activeExports[30].lastNotifiedProcessed, 10);

  const previousSetTimeout = globalThis.setTimeout;
  let cleanup = null;
  globalThis.setTimeout = (callback) => {
    cleanup = callback;
    return 1;
  };
  try {
    handlers.exportComplete(
      {
        data: {
          exportMode: "summary",
          filesProcessed: 10,
          filesErrored: 1,
          filesTotal: 11,
          audioExported: 0,
          audioErrors: 0,
          summariesExported: 9,
          summaryErrors: 1,
        },
      },
      { tab: { id: 30 } },
      reply
    );
  } finally {
    globalThis.setTimeout = previousSetTimeout;
  }
  assert.equal(activeExports[30].status, "completed");
  assert.equal(activeExports[30].filesTotal, 11);
  cleanup();
  assert.equal(activeExports[30], undefined);

  await startBackgroundExport(31, "both", exportDeps());
  handlers.stopExport({ tabId: 31 }, {}, reply);
  assert.equal(stopFlags.has(31), true);
  assert.equal(activeTabIds.has(31), false);
  handlers.checkShouldStop({}, { tab: { id: 31 } }, reply);
  assert.equal(responses.at(-1).shouldStop, true);

  handlers.foregroundExportComplete(
    { tabId: 31, data: { filesProcessed: 1 } },
    {},
    reply
  );
  assert.equal(calls.runtimeMessages.at(-1).action, "foregroundExportComplete");
});

test("smart sync handlers stream, complete and expire stale state", () => {
  const calls = installBackgroundChromeMock();
  resetSmartSyncState();
  const handlers = createSmartSyncHandlers();
  const responses = [];
  const reply = (response) => responses.push(response);

  handlers.startSmartSync({ tabId: "bad" }, {}, reply);
  assert.equal(responses.at(-1).success, false);

  handlers.smartSyncProgress(
    {
      data: {
        processed: 1,
        total: 2,
        new: 1,
        updated: 0,
        skipped: 0,
      },
    },
    { tab: { id: 40 } },
    reply
  );
  assert.equal(activeSmartSyncTabIds.has(40), true);
  assert.equal(activeSmartSyncs[40].status, "running");
  assert.equal(calls.runtimeMessages.at(-1).action, "smartSyncStatusUpdate");

  handlers.getSmartSyncStatus({ tabId: 40 }, {}, reply);
  assert.equal(responses.at(-1).isRunning, true);

  handlers.smartSyncComplete(
    { data: { status: "completed", new: 1, updated: 0, skipped: 0 } },
    { tab: { id: 40 } },
    reply
  );
  assert.equal(activeSmartSyncTabIds.has(40), false);
  assert.equal(activeSmartSyncs[40].status, "completed");

  handlers.smartSyncProgress(
    { data: { startedAt: 1, lastUpdateTime: 1 } },
    { tab: { id: 41 } },
    reply
  );
  activeSmartSyncs[41].lastUpdateTime = 1;
  handlers.getSmartSyncStatus({ tabId: 41 }, {}, reply);
  assert.equal(responses.at(-1).isRunning, false);
  assert.equal(activeSmartSyncs[41].status, "error");
});
