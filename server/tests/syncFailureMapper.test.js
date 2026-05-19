import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySyncFailure,
  SYNC_FAILURE_AUTH,
  SYNC_FAILURE_LOCK,
  SYNC_FAILURE_OTHER,
  SYNC_FAILURE_PLAUD_CHANGED,
} from "../src/sync/syncFailureMapper.js";
import { PlaudAuthError, PlaudChangedError } from "../src/plaud/errors.js";
import { SyncLockError } from "../src/sync/runLock.js";

test("classifySyncFailure recognizes SyncLockError as exit code 4", () => {
  const err = new SyncLockError("busy", { pid: 1234 });
  const f = classifySyncFailure(err);
  assert.equal(f.kind, SYNC_FAILURE_LOCK);
  assert.equal(f.exitCode, 4);
  assert.deepEqual(f.lockInfo, { pid: 1234 });
});

test("classifySyncFailure recognizes PlaudAuthError as exit code 2", () => {
  const f = classifySyncFailure(new PlaudAuthError("401", 401));
  assert.equal(f.kind, SYNC_FAILURE_AUTH);
  assert.equal(f.exitCode, 2);
});

test("classifySyncFailure recognizes PlaudChangedError as exit code 3", () => {
  const stats = { new: 0, updated: 0, unchanged: 0, errors: 1, plaudChanged: true };
  const err = new PlaudChangedError("unexpected shape", {});
  err.stats = stats;
  const f = classifySyncFailure(err);
  assert.equal(f.kind, SYNC_FAILURE_PLAUD_CHANGED);
  assert.equal(f.exitCode, 3);
  assert.equal(f.stats, stats);
});

test("classifySyncFailure falls back to classifier exit code for generic errors", () => {
  const err = new Error("fetch failed");
  const f = classifySyncFailure(err);
  assert.equal(f.kind, SYNC_FAILURE_OTHER);
  assert.equal(f.exitCode, 1);
  assert.ok(f.classified);
  assert.equal(f.classified.kind, "network_error");
});

test("classifySyncFailure honors an explicit exitCode on the error", () => {
  const err = new Error("boom");
  err.exitCode = 3;
  const f = classifySyncFailure(err);
  assert.equal(f.kind, SYNC_FAILURE_OTHER);
  assert.equal(f.exitCode, 3);
});
