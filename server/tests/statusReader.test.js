import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const dir = await mkdtemp(join(tmpdir(), "plaud-status-reader-"));
process.env.PLAUD_DATA_DIR = join(dir, ".data");
process.env.PLAUD_STATUS_PATH = join(dir, ".data", "status.json");
process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

const { readStatus } = await import("../src/sync/statusReader.js");

async function writeStatusFixture(payload) {
  await mkdir(join(dir, ".data"), { recursive: true });
  await writeFile(
    process.env.PLAUD_STATUS_PATH,
    JSON.stringify(payload),
    "utf8"
  );
}

test("readStatus returns null for missing or invalid JSON", async () => {
  assert.equal(await readStatus(join(dir, "missing.json")), null);
  await mkdir(join(dir, ".data"), { recursive: true });
  await writeFile(process.env.PLAUD_STATUS_PATH, "not-json", "utf8");
  assert.equal(await readStatus(), null);
});

test("readStatus normalizes legacy string lastAuthError", async () => {
  await writeStatusFixture({
    lastSyncAt: null,
    lastSyncStats: null,
    lastAuthError: "401 Unauthorized",
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const status = await readStatus();
  assert.equal(status?.lastAuthError?.message, "401 Unauthorized");
  assert.match(String(status?.lastAuthError?.at), /^\d{4}-\d{2}-\d{2}T/);
});

test("readStatus preserves normalized object lastAuthError", async () => {
  await writeStatusFixture({
    lastSyncAt: "2026-05-01T10:00:00.000Z",
    lastSyncStats: { status: "completed" },
    lastAuthError: {
      message: "session expired",
      at: "2026-05-01T09:00:00.000Z",
    },
    updatedAt: "2026-05-01T10:00:00.000Z",
  });
  const status = await readStatus();
  assert.deepEqual(status?.lastAuthError, {
    message: "session expired",
    at: "2026-05-01T09:00:00.000Z",
  });
});

test("readStatus clears empty lastAuthError", async () => {
  await writeStatusFixture({
    lastAuthError: "",
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const status = await readStatus();
  assert.equal(status?.lastAuthError, null);
});
