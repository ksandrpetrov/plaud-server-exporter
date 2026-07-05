import assert from "node:assert/strict";
import test from "node:test";
import { smartSyncBusyErrorKey } from "../content/contentSyncLocks.js";

test("smartSyncBusyErrorKey blocks when export is running", () => {
  assert.equal(
    smartSyncBusyErrorKey({ exportRunLock: true, smartSyncLock: false }),
    "sync.busy"
  );
});

test("smartSyncBusyErrorKey blocks duplicate smart sync", () => {
  assert.equal(
    smartSyncBusyErrorKey({ exportRunLock: false, smartSyncLock: true }),
    "sync.alreadyRunning"
  );
});

test("smartSyncBusyErrorKey allows start when idle", () => {
  assert.equal(
    smartSyncBusyErrorKey({ exportRunLock: false, smartSyncLock: false }),
    null
  );
});
