import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadPlaudPopupScript(relativePath) {
  const code = readFileSync(join(root, relativePath), "utf8");
  const sandbox = { globalThis: {}, setTimeout, clearTimeout };
  vm.runInNewContext(code, sandbox, { filename: relativePath });
  return sandbox.globalThis.PlaudPopup;
}

const PP = loadPlaudPopupScript("popup/exportStatusPolling.js");

test("resolveExportStatusTabId prefers active export tab", () => {
  assert.equal(
    PP.resolveExportStatusTabId({
      exportActive: true,
      currentExportTabId: 42,
      focusedTab: { id: 7 },
      isPlaudTab: () => true,
    }),
    42
  );
  assert.equal(
    PP.resolveExportStatusTabId({
      exportActive: false,
      currentExportTabId: null,
      focusedTab: { id: 7 },
      isPlaudTab: () => true,
    }),
    7
  );
});

test("createExportStatusFinalizer deduplicates successful responses", () => {
  let calls = 0;
  const timers = [];
  const finalizer = PP.createExportStatusFinalizer({
    timeoutMs: 50,
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    },
    clearTimer: clearTimeout,
    onFinalize() {
      calls += 1;
    },
  });
  finalizer.finalize(null, { success: true, isRunning: false });
  finalizer.finalize(null, { success: true, isRunning: true });
  assert.equal(calls, 1);
  timers.forEach(clearTimeout);
});

test("shouldStopExportPollingAfterErrors stops after threshold", () => {
  assert.equal(PP.shouldStopExportPollingAfterErrors(3), false);
  assert.equal(PP.shouldStopExportPollingAfterErrors(4), true);
});

test("finalizer times out exactly once and ignores a late response", () => {
  let fire;
  let cleared = 0;
  const results = [];
  const finalizer = PP.createExportStatusFinalizer({
    setTimer(fn) {
      fire = fn;
      return 1;
    },
    clearTimer() {
      cleared++;
    },
    onFinalize(error, response) {
      results.push({ error, response });
    },
  });
  fire();
  finalizer.finalize(null, { success: true });
  assert.equal(results.length, 1);
  assert.match(results[0].error.message, /timeout/);
  assert.equal(results[0].response, null);
  assert.equal(cleared, 1);
});

test("cancelling finalizer suppresses both timer and response", () => {
  let fire;
  let calls = 0;
  const finalizer = PP.createExportStatusFinalizer({
    setTimer(fn) {
      fire = fn;
      return 1;
    },
    clearTimer() {},
    onFinalize() {
      calls++;
    },
  });
  finalizer.cancel();
  fire();
  finalizer.finalize(null, { success: true });
  assert.equal(calls, 0);
});
