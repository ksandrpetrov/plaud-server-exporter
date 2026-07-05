import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostname } from "node:os";

const STALE_LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

async function withDataDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plaud-runlock-"));
  const dataDir = join(dir, ".data");
  process.env.PLAUD_DATA_DIR = dataDir;
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");
  try {
    return await fn({ dir, dataDir, lockPath: join(dataDir, "sync.lock") });
  } finally {
    // temp dir left to OS cleanup
  }
}

async function writeLockFile(lockPath, payload, { mtimeMs } = {}) {
  await mkdir(join(lockPath, ".."), { recursive: true });
  await writeFile(lockPath, JSON.stringify(payload), "utf8");
  if (mtimeMs != null) {
    const when = new Date(mtimeMs);
    await utimes(lockPath, when, when);
  }
}

test("acquireSyncLock rejects a fresh lock held by a live pid", async () => {
  await withDataDir(async ({ lockPath }) => {
    const { acquireSyncLock, SyncLockError } =
      await import("../src/sync/runLock.js");

    await writeLockFile(lockPath, {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () => acquireSyncLock(),
      (err) => {
        assert.ok(err instanceof SyncLockError);
        assert.match(String(err.message), /already holds the sync lock/);
        return true;
      }
    );
  });
});

test("acquireSyncLock reclaims a lock whose pid is dead", async () => {
  await withDataDir(async ({ lockPath }) => {
    const { acquireSyncLock, syncLockPath } =
      await import("../src/sync/runLock.js");

    await writeLockFile(lockPath, {
      pid: 9_999_999,
      host: hostname(),
      startedAt: new Date().toISOString(),
    });

    const release = await acquireSyncLock();
    try {
      const info = JSON.parse(await readFile(syncLockPath(), "utf8"));
      assert.equal(info.pid, process.pid);
    } finally {
      await release();
    }
  });
});

test("acquireSyncLock reclaims a lock older than STALE_LOCK_MAX_AGE_MS", async () => {
  await withDataDir(async ({ lockPath }) => {
    const { acquireSyncLock, syncLockPath } =
      await import("../src/sync/runLock.js");

    const staleAt = Date.now() - STALE_LOCK_MAX_AGE_MS - 60_000;
    await writeLockFile(
      lockPath,
      {
        pid: process.pid,
        host: hostname(),
        startedAt: new Date(staleAt).toISOString(),
      },
      { mtimeMs: staleAt }
    );

    const release = await acquireSyncLock();
    try {
      const info = JSON.parse(await readFile(syncLockPath(), "utf8"));
      assert.equal(info.pid, process.pid);
    } finally {
      await release();
    }
  });
});

test("acquireSyncLock reclaims a lock with corrupt JSON payload", async () => {
  await withDataDir(async ({ lockPath }) => {
    const { acquireSyncLock, syncLockPath } =
      await import("../src/sync/runLock.js");

    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(lockPath, "not-json{{{", "utf8");

    const release = await acquireSyncLock();
    try {
      const info = JSON.parse(await readFile(syncLockPath(), "utf8"));
      assert.equal(info.pid, process.pid);
    } finally {
      await release();
    }
  });
});

test("acquireSyncLock does not reclaim a lock from another host", async () => {
  await withDataDir(async ({ lockPath }) => {
    const { acquireSyncLock, SyncLockError } =
      await import("../src/sync/runLock.js");

    await writeLockFile(lockPath, {
      pid: 9_999_999,
      host: "other-host.example",
      startedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () => acquireSyncLock(),
      (err) => {
        assert.ok(err instanceof SyncLockError);
        return true;
      }
    );
  });
});

test("releaseSyncLock removes the lock file", async () => {
  await withDataDir(async ({ lockPath }) => {
    const { acquireSyncLock } = await import("../src/sync/runLock.js");

    const release = await acquireSyncLock();
    await release();
    await assert.rejects(() => stat(lockPath), { code: "ENOENT" });
  });
});
