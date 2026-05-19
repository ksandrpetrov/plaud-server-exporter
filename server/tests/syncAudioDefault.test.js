import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-sync-default-"));
process.env.PLAUD_DATA_DIR = join(tmpRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");
process.env.PLAUD_TIMEZONE = "UTC";
process.env.PLAUD_MIRROR_FOLDERS = "false";

const { runSync } = await import("../src/sync/syncRunner.js");

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

test("runSync does not call audio temp-url endpoint", async () => {
  const urls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/file/simple/web")) {
      return jsonResponse({
        data: [
          {
            file_id: "abcdef0123456789abcdef0123456789",
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
            data_title: "Summary",
            data_content: "# Team sync\n\nNotes",
          },
        ],
      });
    }
    if (u.includes("/file/temp-url")) {
      throw new Error("audio endpoint must not be called");
    }
    return jsonResponse({});
  };
  try {
    const stats = await runSync({ session, dryRun: true });
    assert.equal(stats.audioDownloaded, 0);
    assert.ok(!urls.some((u) => u.includes("/file/temp-url")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
