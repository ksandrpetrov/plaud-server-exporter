import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-dryrun-"));
process.env.PLAUD_DATA_DIR = join(tmpRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");
process.env.PLAUD_TIMEZONE = "UTC";
process.env.PLAUD_MIRROR_FOLDERS = "false";

const { runSync } = await import("../src/sync/syncRunner.js");
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

test("runSync --dry-run does not write Markdown or index but counts actions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/file/simple/web")) {
      const skip = Number(new URL(u).searchParams.get("skip") || "0");
      if (skip > 0) return jsonResponse({ data: [] });
      return jsonResponse({
        data: [
          {
            file_id: "abcdef0123456789abcdef0123456789",
            file_name: "First meeting",
            created_at: "2026-05-17T10:00:00.000Z",
          },
          {
            file_id: "11112222333344445555666677778888",
            file_name: "Second meeting",
            created_at: "2026-05-18T10:00:00.000Z",
          },
        ],
      });
    }
    if (u.includes("/ai/query_note")) {
      return jsonResponse({
        data: [
          {
            data_type: "summary",
            data_title: "Summary",
            data_content: "# Body\n\nNotes",
          },
        ],
      });
    }
    return jsonResponse({});
  };
  try {
    const stats = await runSync({ session, dryRun: true });
    assert.equal(stats.total, 2);
    assert.equal(stats.new, 2);
    assert.equal(stats.processed, 2);
    assert.equal(stats.dryRun, true);
    // Index file should not be created in dry-run
    await assert.rejects(() => stat(config.syncIndexPath), { code: "ENOENT" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
