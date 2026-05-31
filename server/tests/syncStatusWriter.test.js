import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const dir = await mkdtemp(join(tmpdir(), "plaud-status-writer-"));
process.env.PLAUD_DATA_DIR = join(dir, ".data");
process.env.PLAUD_STATUS_PATH = join(dir, ".data", "status.json");
process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

const { normalizeLastAuthError, writeStatusFile, recordAuthError } =
  await import("../src/sync/syncStatusWriter.js");

test("normalizeLastAuthError wraps plain strings", () => {
  const normalized = normalizeLastAuthError("401 Unauthorized");
  assert.equal(normalized?.message, "401 Unauthorized");
  assert.match(String(normalized?.at), /^\d{4}-\d{2}-\d{2}T/);
});

test("normalizeLastAuthError preserves object shape", () => {
  const normalized = normalizeLastAuthError({
    message: "expired",
    at: "2026-05-01T00:00:00.000Z",
  });
  assert.deepEqual(normalized, {
    message: "expired",
    at: "2026-05-01T00:00:00.000Z",
  });
});

test("normalizeLastAuthError returns null for empty values", () => {
  assert.equal(normalizeLastAuthError(null), null);
  assert.equal(normalizeLastAuthError(""), null);
});

test("writeStatusFile writes stats and auth error atomically", async () => {
  const stats = {
    status: "failed",
    finishedAt: "2026-05-01T12:00:00.000Z",
    errors: 1,
  };
  await writeStatusFile({ stats, lastAuthError: "401 Unauthorized" });
  const payload = JSON.parse(
    await readFile(process.env.PLAUD_STATUS_PATH, "utf8")
  );
  assert.equal(payload.lastSyncAt, stats.finishedAt);
  assert.deepEqual(payload.lastSyncStats, stats);
  assert.equal(payload.lastAuthError.message, "401 Unauthorized");
  assert.match(String(payload.updatedAt), /^\d{4}-\d{2}-\d{2}T/);
});

test("recordAuthError merges into existing status without dropping stats", async () => {
  await writeStatusFile({
    stats: { status: "completed", finishedAt: "2026-05-01T10:00:00.000Z" },
  });
  await recordAuthError("session expired");
  const payload = JSON.parse(
    await readFile(process.env.PLAUD_STATUS_PATH, "utf8")
  );
  assert.equal(payload.lastSyncStats.status, "completed");
  assert.equal(payload.lastAuthError.message, "session expired");
});
