import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-sync-candidate-"));
process.env.PLAUD_DATA_DIR = join(tmpRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");
process.env.PLAUD_TIMEZONE = "UTC";

const {
  buildCandidate,
  needsSummaryRestore,
  resolveSyncFolderSegment,
  summaryFileExists,
} = await import("../src/sync/syncCandidate.js");
const { PLAUD_FOLDER_UNFILED } = await import("../src/plaud/plaudFolders.js");

test("resolveSyncFolderSegment returns empty when mirrorFolders is false", () => {
  process.env.PLAUD_MIRROR_FOLDERS = "false";
  assert.equal(resolveSyncFolderSegment({ folderSegment: "Work" }), "");
});

test("resolveSyncFolderSegment returns segment or Unfiled when mirrorFolders is true", () => {
  process.env.PLAUD_MIRROR_FOLDERS = "true";
  assert.equal(resolveSyncFolderSegment({ folderSegment: "Work" }), "Work");
  assert.equal(
    resolveSyncFolderSegment({ folderSegment: "" }),
    PLAUD_FOLDER_UNFILED
  );
  process.env.PLAUD_MIRROR_FOLDERS = "false";
});

test("needsSummaryRestore is false when summary file exists on disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-candidate-restore-"));
  const summaryPath = join(dir, "note.md");
  await writeFile(summaryPath, "# Summary\n", "utf8");

  const needs = await needsSummaryRestore(
    { summaryHash: "abc", summaryPath },
    summaryPath
  );
  assert.equal(needs, false);
});

test("needsSummaryRestore is true when index has hash but file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-candidate-missing-"));
  const summaryPath = join(dir, "missing.md");

  const needs = await needsSummaryRestore(
    { summaryHash: "abc", summaryPath },
    summaryPath
  );
  assert.equal(needs, true);
});

test("needsSummaryRestore is false without existing summaryHash", async () => {
  const needs = await needsSummaryRestore({}, "/tmp/any.md");
  assert.equal(needs, false);
});

test("summaryFileExists returns false for missing path", async () => {
  assert.equal(
    await summaryFileExists("/tmp/plaud-missing-summary-test.md"),
    false
  );
});

test("buildCandidate builds stable identity and summary hash", async () => {
  process.env.PLAUD_MIRROR_FOLDERS = "true";
  const file = {
    id: "abcdef0123456789abcdef0123456789",
    title: "Weekly sync",
    folderSegment: "Team",
    raw: {
      file_id: "abcdef0123456789abcdef0123456789",
      file_name: "Weekly sync",
      created_at: "2026-05-17T10:00:00.000Z",
      updated_at: "2026-05-17T11:00:00.000Z",
    },
  };
  const summaries = [{ markdown: "Discussed roadmap", type: "summary" }];

  const candidate = await buildCandidate(file, summaries);

  assert.match(candidate.stableId, /^plaud:[a-f0-9]{32}$/);
  assert.equal(candidate.title, "Weekly sync");
  assert.equal(candidate.folderSegment, "Team");
  assert.match(candidate.summaryHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(candidate.createdAt, "2026-05-17T10:00:00.000Z");
  assert.equal(candidate.updatedAt, "2026-05-17T11:00:00.000Z");
  process.env.PLAUD_MIRROR_FOLDERS = "false";
});
