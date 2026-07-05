import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlaudAuthError } from "../src/plaud/errors.js";
import { SyncLockError } from "../src/sync/runLock.js";
import {
  SYNC_ACTION_MANUAL,
  syncRunGuard,
} from "../src/telegram/syncGuards.js";
import { runSyncSilent } from "../src/telegram/sync/syncRunBridge.js";

const okSession = { token: "fake" };
const okStats = {
  new: 1,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  errors: 0,
  status: "completed",
};

test("runSyncSilent returns no_session when loader returns null", async () => {
  syncRunGuard.reset();
  const result = await runSyncSilent({
    sessionLoader: async () => null,
  });
  assert.equal(result.status, "no_session");
});

test("runSyncSilent returns ok with stats on successful sync", async () => {
  syncRunGuard.reset();
  const result = await runSyncSilent({
    sessionLoader: async () => okSession,
    syncRunner: async () => okStats,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.stats, okStats);
});

test("runSyncSilent maps PlaudAuthError to auth status and records failure", async () => {
  syncRunGuard.reset();
  const dataDir = await mkdtemp(join(tmpdir(), "plaud-silent-auth-"));
  const prev = process.env.PLAUD_DATA_DIR;
  process.env.PLAUD_DATA_DIR = dataDir;
  try {
    const result = await runSyncSilent({
      sessionLoader: async () => okSession,
      syncRunner: async () => {
        throw new PlaudAuthError("401", 401);
      },
    });
    assert.equal(result.status, "auth_rejected");
  } finally {
    if (prev === undefined) delete process.env.PLAUD_DATA_DIR;
    else process.env.PLAUD_DATA_DIR = prev;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runSyncSilent maps SyncLockError to lock_busy", async () => {
  syncRunGuard.reset();
  const result = await runSyncSilent({
    sessionLoader: async () => okSession,
    syncRunner: async () => {
      throw new SyncLockError("busy", { pid: 99 });
    },
  });
  assert.equal(result.status, "lock_busy");
});

test("runSyncSilent skips ActionGuard when chatId is null", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_MANUAL);
  const result = await runSyncSilent({
    chatId: null,
    sessionLoader: async () => okSession,
    syncRunner: async () => okStats,
  });
  assert.equal(result.status, "ok");
});

test("runSyncSilent returns lock_busy when ActionGuard rejects chatId", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_MANUAL);
  const result = await runSyncSilent({
    chatId: 42,
    sessionLoader: async () => okSession,
    syncRunner: async () => okStats,
  });
  assert.equal(result.status, "lock_busy");
});
