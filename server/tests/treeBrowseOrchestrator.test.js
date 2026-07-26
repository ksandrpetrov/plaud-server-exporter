import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-tree-orchestrator-"));
process.env.PLAUD_DATA_DIR = join(tmpRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");

const { isReadablePath, resolveSummaryPathAfterSync } =
  await import("../src/telegram/treeBrowseOrchestrator.js");

test("isReadablePath returns true for existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-readable-"));
  const file = join(dir, "note.md");
  await writeFile(file, "# ok\n", "utf8");
  assert.equal(await isReadablePath(file), true);
  assert.equal(await isReadablePath(join(dir, "missing.md")), false);
});

test("resolveSummaryPathAfterSync returns readable summary path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-resolve-path-"));
  const summaryPath = join(dir, "weekly.md");
  await writeFile(summaryPath, "# Weekly\n", "utf8");

  const resolved = await resolveSummaryPathAfterSync("plaud:abc", {
    loadIndex: async () => ({
      records: {
        "plaud:abc": { stableId: "plaud:abc", summaryPath },
      },
    }),
  });

  assert.equal(resolved, summaryPath);
});

test("resolveSummaryPathAfterSync returns null when file missing on disk", async () => {
  assert.equal(
    await resolveSummaryPathAfterSync("plaud:abc", {
      loadIndex: async () => ({
        records: {
          "plaud:abc": {
            stableId: "plaud:abc",
            summaryPath: "/tmp/plaud-missing-summary.md",
          },
        },
      }),
    }),
    null
  );
});
