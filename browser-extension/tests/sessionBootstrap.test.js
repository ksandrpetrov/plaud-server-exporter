import assert from "node:assert/strict";
import test from "node:test";
import {
  activeExports,
  activeTabIds,
  resetExportState,
  restoreExportStateFromSession,
} from "../background/exportStateStore.js";
import { resetSmartSyncState } from "../background/smartSyncStateStore.js";
import {
  ensureSessionRestored,
  resetSessionRestorePromise,
} from "../background/sessionBootstrap.js";

function installChromeStorageMock(initial = {}) {
  const store = { ...initial };
  globalThis.chrome = {
    storage: {
      session: {
        get(keys, callback) {
          const result = {};
          for (const key of keys) {
            if (key in store) result[key] = store[key];
          }
          callback(result);
        },
        set() {},
      },
    },
    runtime: { lastError: null },
    tabs: {
      get(_tabId, callback) {
        const tab = { id: _tabId, autoDiscardable: false };
        if (typeof callback === "function") {
          callback(tab);
          return;
        }
        return Promise.resolve(tab);
      },
      sendMessage(_tabId, _message, callback) {
        if (typeof callback === "function") callback({});
        return Promise.resolve({});
      },
      update: () => Promise.resolve(),
    },
    downloads: {},
  };
}

test("ensureSessionRestored resolves and returns the same promise", async () => {
  installChromeStorageMock();
  resetExportState();
  resetSmartSyncState();
  resetSessionRestorePromise();

  const first = ensureSessionRestored();
  const second = ensureSessionRestored();
  assert.strictEqual(first, second);
  await first;
});

test("restoreExportStateFromSession repopulates running exports", async () => {
  installChromeStorageMock({
    plaudBgExportV1: {
      v: 1,
      activeExports: {
        42: {
          status: "running",
          lastUpdateTime: Date.now(),
          startTime: Date.now(),
        },
      },
      stopFlagTabIds: [],
      savedAt: Date.now(),
    },
  });
  resetExportState();

  await new Promise((resolve) => restoreExportStateFromSession(resolve));

  assert.equal(activeTabIds.has(42), true);
  assert.equal(activeExports[42]?.status, "running");
});

test("resetSessionRestorePromise allows a fresh restore cycle", async () => {
  installChromeStorageMock();
  resetExportState();
  resetSmartSyncState();
  resetSessionRestorePromise();

  const first = ensureSessionRestored();
  await first;
  resetSessionRestorePromise();
  const second = ensureSessionRestored();
  assert.notStrictEqual(first, second);
  await second;
});
