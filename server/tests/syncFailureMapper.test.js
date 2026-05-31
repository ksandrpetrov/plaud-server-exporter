import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifySyncFailure,
  mapSyncFailureToBotOutcome,
  recordAuthFailureIfNeeded,
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
  const stats = {
    new: 0,
    updated: 0,
    unchanged: 0,
    errors: 1,
    plaudChanged: true,
  };
  const err = new PlaudChangedError("unexpected shape", {});
  err.stats = stats;
  const f = classifySyncFailure(err);
  assert.equal(f.kind, SYNC_FAILURE_PLAUD_CHANGED);
  assert.equal(f.exitCode, 3);
  assert.equal(f.stats, stats);
});

test("classifySyncFailure treats shape-change messages as plaud_changed", () => {
  const err = new Error("unexpected response shape from /file/simple/web");
  const f = classifySyncFailure(err);
  assert.equal(f.kind, SYNC_FAILURE_PLAUD_CHANGED);
  assert.equal(f.exitCode, 3);
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

test("mapSyncFailureToBotOutcome maps silent vs interactive plaud_changed", () => {
  const failure = { kind: SYNC_FAILURE_PLAUD_CHANGED };
  assert.equal(mapSyncFailureToBotOutcome(failure).status, "plaud_changed");
  assert.equal(
    mapSyncFailureToBotOutcome(failure, { interactive: true }).status,
    "failed"
  );
});

test("mapSyncFailureToBotOutcome maps lock and auth", () => {
  assert.equal(
    mapSyncFailureToBotOutcome({ kind: SYNC_FAILURE_LOCK }).status,
    "lock_busy"
  );
  assert.equal(
    mapSyncFailureToBotOutcome({ kind: SYNC_FAILURE_AUTH }).status,
    "auth_rejected"
  );
});

test("recordAuthFailureIfNeeded writes auth error to status.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-auth-failure-"));
  const statusPath = join(dir, "status.json");
  const prev = process.env.PLAUD_STATUS_PATH;
  process.env.PLAUD_STATUS_PATH = statusPath;
  try {
    await recordAuthFailureIfNeeded(
      { kind: SYNC_FAILURE_LOCK, exitCode: 4 },
      new Error("ignored")
    );
    assert.equal(await readFile(statusPath, "utf8").catch(() => null), null);

    await recordAuthFailureIfNeeded(
      { kind: SYNC_FAILURE_AUTH, exitCode: 2 },
      new PlaudAuthError("session expired", 401)
    );
    const parsed = JSON.parse(await readFile(statusPath, "utf8"));
    assert.equal(parsed.lastAuthError.message, "session expired");
    assert.ok(parsed.lastAuthError.at);
  } finally {
    if (prev === undefined) delete process.env.PLAUD_STATUS_PATH;
    else process.env.PLAUD_STATUS_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
});
