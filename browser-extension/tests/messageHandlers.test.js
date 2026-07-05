import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryPlaudFetchAttempt } from "../features/audioExport/plaudFetchRetry.js";
import { buildSyncCandidate } from "../features/audioExport/extensionSyncCandidate.js";
import { shouldEvictStaleRunningExport } from "../background/handlers/statusHandlers.js";
import { PING_STALE_AFTER_MS } from "../background/exportStateStore.js";

test("shouldRetryPlaudFetchAttempt rejects auth errors", () => {
  assert.equal(
    shouldRetryPlaudFetchAttempt(new Error("HTTP 401 Unauthorized")),
    false
  );
  assert.equal(shouldRetryPlaudFetchAttempt(new Error("network"), 429), true);
});

test("buildSyncCandidate returns plaud stable id", async () => {
  const candidate = await buildSyncCandidate(
    {
      id: "abcdef0123456789abcdef0123456789",
      title: "Weekly",
      raw: { file_id: "abcdef0123456789abcdef0123456789" },
      folderSegment: "Work",
    },
    [{ markdown: "# Weekly\nBody" }],
    "https://web.plaud.ai/file/abc"
  );
  assert.match(candidate.stableId, /^plaud:[a-f0-9]{32}$/);
  assert.equal(candidate.folderSegment, "Work");
});

test("shouldEvictStaleRunningExport evicts dead tab after stale window", () => {
  const now = 10_000;
  assert.equal(
    shouldEvictStaleRunningExport({
      entry: { status: "running", lastUpdateTime: 1000 },
      tabTracked: true,
      tabAlive: false,
      nowMs: now,
      staleAfterMs: PING_STALE_AFTER_MS,
    }),
    now - 1000 > PING_STALE_AFTER_MS
  );
  assert.equal(
    shouldEvictStaleRunningExport({
      entry: { status: "running", lastUpdateTime: now - 100 },
      tabTracked: true,
      tabAlive: true,
      nowMs: now,
      staleAfterMs: PING_STALE_AFTER_MS,
    }),
    false
  );
});
