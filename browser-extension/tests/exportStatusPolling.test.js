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

test("createExportStatusFinalizer dedupes and fires timeout", () => {
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
