import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-sync-errors-"));
process.env.PLAUD_DATA_DIR = join(tmpRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");
process.env.PLAUD_TIMEZONE = "UTC";
process.env.PLAUD_MIRROR_FOLDERS = "false";

const { runSync, SyncLockError } = await import("../src/sync/syncRunner.js");
const { acquireSyncLock } = await import("../src/sync/runLock.js");
const { ERROR_KIND_PLAUD_CHANGED } =
  await import("../src/errors/errorClassifier.js");
const { PlaudChangedError } = await import("../src/plaud/plaudApiClient.js");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const session = {
  apiBase: "https://api.plaud.ai",
  authHeader: "Bearer t.t.t",
  userAuthHeader: "Bearer t.t.t",
  workspaceAuthHeader: "",
  workspaceId: "ws-1",
  sortBy: "start_time",
  userId: "u-1",
};

test("unexpected list-recordings shape produces plaud_changed and exit 3", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-changed-list-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      // Looks like a payload but has no array under any known key.
      return jsonResponse({ status: 0, data: { foo: "bar" } });
    }
    return jsonResponse({});
  };
  try {
    await assert.rejects(
      () => runSync({ session, summaryOnly: true }),
      (err) => err instanceof PlaudChangedError && err.exitCode === 3
    );
    const errDir = join(dir, "exports", "_errors");
    const files = (await readdir(errDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length >= 1, "should write a _errors/*.md report");
    const body = await readFile(join(errDir, files[0]), "utf8");
    assert.match(body, /Kind: plaud_changed/);
    assert.match(body, /Plaud, вероятно, изменил API/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unexpected summary shape marks plaud_changed and emits exit 3", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-changed-summary-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      return jsonResponse({
        data: [
          {
            file_id: "abcdef0123456789abcdef0123456789",
            file_name: "Strategy",
            created_at: "2026-05-17T10:00:00.000Z",
          },
        ],
      });
    }
    if (u.includes("/ai/query_note")) {
      // Looks like a Plaud response but contains no recognizable summary
      // notes — should be classified as plaud_changed.
      return jsonResponse({ status: 0, data: { totally_new_field: 1 } });
    }
    return jsonResponse({});
  };
  try {
    await assert.rejects(
      () => runSync({ session, summaryOnly: true }),
      (err) => err.exitCode === 3
    );
    const errDir = join(dir, "exports", "_errors");
    const files = (await readdir(errDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recordings without a normalizable id are skipped, not crashed on", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-missing-id-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      return jsonResponse({
        data: [
          // No id-shaped field — exporter must filter this out, not throw.
          { file_name: "Nameless", created_at: "2026-05-17T10:00:00.000Z" },
          {
            file_id: "abcdef0123456789abcdef0123456789",
            file_name: "Has ID",
            created_at: "2026-05-17T10:00:00.000Z",
          },
        ],
      });
    }
    if (u.includes("/ai/query_note")) {
      return jsonResponse({
        data: [{ data_type: "summary", data_content: "# Has ID\n\nBody" }],
      });
    }
    return jsonResponse({});
  };
  try {
    const stats = await runSync({ session, summaryOnly: true });
    assert.equal(
      stats.total,
      1,
      "no-id recordings must be filtered before sync"
    );
    assert.equal(stats.new, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("acquireSyncLock prevents a parallel run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-lock-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      return jsonResponse({ data: [] });
    }
    return jsonResponse({});
  };
  try {
    const release = await acquireSyncLock();
    try {
      await assert.rejects(
        () => runSync({ session, summaryOnly: true }),
        (err) => err instanceof SyncLockError
      );
      // After releasing, sync can proceed.
      await release();
      const stats = await runSync({ session, summaryOnly: true });
      assert.equal(stats.total, 0);
      // Lock file must be removed on success.
      await assert.rejects(() => stat(join(dir, ".data", "sync.lock")), {
        code: "ENOENT",
      });
    } catch (err) {
      await release().catch(() => {});
      throw err;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dry-run is not blocked by an existing lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-lock-dry-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      return jsonResponse({ data: [] });
    }
    return jsonResponse({});
  };
  try {
    const release = await acquireSyncLock();
    try {
      const stats = await runSync({ session, dryRun: true, summaryOnly: true });
      assert.equal(stats.dryRun, true);
    } finally {
      await release().catch(() => {});
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Use the plaud_changed kind import to keep eslint happy in case the imports
// are reorganized; this is also a structural assertion.
test("plaud_changed kind constant is exported", () => {
  assert.equal(ERROR_KIND_PLAUD_CHANGED, "plaud_changed");
});
