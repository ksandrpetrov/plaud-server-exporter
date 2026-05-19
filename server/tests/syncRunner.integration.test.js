import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-sync-int-"));
process.env.PLAUD_DATA_DIR = join(tmpRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");
process.env.PLAUD_TIMEZONE = "UTC";
process.env.PLAUD_MIRROR_FOLDERS = "false";

const { runSync } = await import("../src/sync/syncRunner.js");
const { loadSyncIndex } = await import("../src/sync/serverSyncIndex.js");
const { config } = await import("../src/config/config.js");

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

const FILE_ID = "abcdef0123456789abcdef0123456789";

function mockFetch(summaryBody = "# Team sync\n\nNotes v1") {
  return async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      const skip = Number(new URL(u).searchParams.get("skip") || "0");
      if (skip > 0) return jsonResponse({ data: [] });
      return jsonResponse({
        data: [
          {
            file_id: FILE_ID,
            file_name: "Team sync",
            created_at: "2026-05-17T10:00:00.000Z",
          },
        ],
      });
    }
    if (u.includes("/ai/query_note")) {
      return jsonResponse({
        data: [
          {
            data_type: "summary",
            data_content: summaryBody,
          },
        ],
      });
    }
    return jsonResponse({});
  };
}

test("first run creates summary; second run skips unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-sync-first-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch();
  try {
    const first = await runSync({ session, summaryOnly: true });
    assert.equal(first.new, 1);
    assert.equal(first.summariesDownloaded, 1);

    const mdPath = join(
      dir,
      "exports",
      "Plaud",
      "2026",
      "2026-05-17 - Team sync.md"
    );
    const body = await readFile(mdPath, "utf8");
    assert.doesNotMatch(body, /^---\n/);
    assert.match(body, /Notes v1/);

    const second = await runSync({ session, summaryOnly: true });
    assert.equal(second.alreadySynced, 1);
    assert.equal(second.unchanged, 1);
    assert.equal(second.new, 0);

    const index = await loadSyncIndex(config.syncIndexPath);
    assert.ok(index.records[`plaud:${FILE_ID}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("changed summary updates file on second run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-sync-update-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = mockFetch("# Team sync\n\nNotes v1");
    await runSync({ session, summaryOnly: true });

    globalThis.fetch = mockFetch("# Team sync\n\nNotes v2");
    const updated = await runSync({ session, summaryOnly: true });
    assert.equal(updated.updated, 1);

    const mdPath = join(
      dir,
      "exports",
      "Plaud",
      "2026",
      "2026-05-17 - Team sync.md"
    );
    const body = await readFile(mdPath, "utf8");
    assert.match(body, /Notes v2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rename-only updates filename when Plaud title changes but summary hash is unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-sync-rename-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  const summaryBody = "# Old title\n\nSame body";
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/file/simple/web")) {
        return jsonResponse({
          data: [
            {
              file_id: FILE_ID,
              file_name: "Old title",
              created_at: "2026-05-17T10:00:00.000Z",
            },
          ],
        });
      }
      if (u.includes("/ai/query_note")) {
        return jsonResponse({
          data: [{ data_type: "summary", data_content: summaryBody }],
        });
      }
      return jsonResponse({});
    };
    await runSync({ session, summaryOnly: true });

    const oldPath = join(dir, "exports", "Plaud", "2026", "2026-05-17 - Old title.md");
    assert.ok(await stat(oldPath));

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/file/simple/web")) {
        return jsonResponse({
          data: [
            {
              file_id: FILE_ID,
              file_name: "New title",
              created_at: "2026-05-17T10:00:00.000Z",
            },
          ],
        });
      }
      if (u.includes("/ai/query_note")) {
        return jsonResponse({
          data: [{ data_type: "summary", data_content: summaryBody }],
        });
      }
      return jsonResponse({});
    };
    const renamed = await runSync({ session, summaryOnly: true });
    assert.equal(renamed.metadataUpdated, 1);
    assert.equal(renamed.unchanged, 0);

    const newPath = join(dir, "exports", "Plaud", "2026", "2026-05-17 - New title.md");
    const body = await readFile(newPath, "utf8");
    assert.match(body, /Same body/);
    await assert.rejects(() => stat(oldPath), { code: "ENOENT" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("same title with different stable ids creates two files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-sync-dup-title-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const idA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const idB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      return jsonResponse({
        data: [
          {
            file_id: idA,
            file_name: "Weekly review",
            created_at: "2026-05-17T10:00:00.000Z",
          },
          {
            file_id: idB,
            file_name: "Weekly review",
            created_at: "2026-05-18T10:00:00.000Z",
          },
        ],
      });
    }
    if (u.includes("/ai/query_note")) {
      const headers = init?.headers || {};
      const fileId =
        headers["file-id"] ||
        headers["File-Id"] ||
        (typeof headers.get === "function" ? headers.get("file-id") : "") ||
        "";
      const tag = fileId === idA ? "alpha" : "beta";
      return jsonResponse({
        data: [
          {
            data_type: "summary",
            data_content: `# Weekly review\n\nNotes for ${tag}`,
          },
        ],
      });
    }
    return jsonResponse({});
  };
  try {
    const stats = await runSync({ session, summaryOnly: true });
    assert.equal(stats.new, 2);
    const files = [
      join(dir, "exports", "Plaud", "2026", "2026-05-17 - Weekly review.md"),
      join(dir, "exports", "Plaud", "2026", "2026-05-18 - Weekly review.md"),
    ];
    const bodies = await Promise.all(files.map((p) => readFile(p, "utf8")));
    assert.match(bodies[0], /alpha/);
    assert.match(bodies[1], /beta/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manually deleted summary file is restored on next sync", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-sync-restore-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const mdPath = join(
    dir,
    "exports",
    "Plaud",
    "2026",
    "2026-05-17 - Team sync.md"
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch();
  try {
    await runSync({ session, summaryOnly: true });
    await unlink(mdPath);

    const restored = await runSync({ session, summaryOnly: true });
    assert.equal(restored.updated, 1);
    assert.equal(restored.unchanged, 0);
    const body = await readFile(mdPath, "utf8");
    assert.match(body, /Notes v1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSync --dry-run does not write Markdown or index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-dryrun2-"));
  process.env.PLAUD_DATA_DIR = join(dir, ".data");
  process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch();
  try {
    const stats = await runSync({ session, dryRun: true, summaryOnly: true });
    assert.equal(stats.new, 1);
    assert.equal(stats.dryRun, true);
    await assert.rejects(() => stat(join(dir, ".data", "sync-index.json")), {
      code: "ENOENT",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
