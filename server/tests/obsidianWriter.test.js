import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.PLAUD_TIMEZONE = "UTC";

const { planAudioPath, buildMarkdownDocument, writeMarkdownFile } =
  await import("../src/sync/obsidianWriter.js");
const { planSummaryPath } = await import("../src/sync/filenamePlanner.js");
const { config } = await import("../src/config/config.js");
const { effectiveVaultRoot } = await import("../src/config/config.js");

test("planSummaryPath places file under {vault}/Plaud/", () => {
  const planned = planSummaryPath({
    title: "Weekly review",
    createdAt: "2026-05-17T12:00:00.000Z",
  });
  const vault = effectiveVaultRoot();
  assert.equal(
    planned.absolutePath,
    resolve(vault, "Plaud", "2026-05-17 - Weekly review.md")
  );
  assert.equal(planned.dateOnly, "2026-05-17");
  assert.equal(
    planned.relativePath,
    join("Plaud", "2026-05-17 - Weekly review.md")
  );
});

test("planAudioPath uses _attachments folder and given extension", () => {
  const planned = planAudioPath({ title: "Customer call", extension: "m4a" });
  const vault = effectiveVaultRoot();
  assert.equal(
    planned.absolutePath,
    resolve(vault, "Plaud", "_attachments", "Customer call.m4a")
  );
});

test("buildMarkdownDocument contains summary body without YAML frontmatter", () => {
  const doc = buildMarkdownDocument({
    file: { id: "f1", title: "Meeting" },
    summaries: [{ title: "Summary", markdown: "# Meeting\n\nNotes" }],
    candidate: {
      stableId: "plaud:f1",
      summaryHash: "sha256:abc",
      createdAt: "2026-05-17T00:00:00.000Z",
    },
  });
  assert.doesNotMatch(doc, /^---\n/);
  assert.match(doc, /Notes/);
  assert.doesNotMatch(doc, /stable_id:/);
  assert.doesNotMatch(doc, /plaud_id:/);
});

test("writeMarkdownFile renames previous file when path changed", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "plaud-writer-"));
  const oldAbs = join(baseDir, "2026-05-17 - Old title.md");
  const newAbs = join(baseDir, "2026-05-17 - New title.md");
  await mkdir(baseDir, { recursive: true });
  await writeMarkdownFile({ absolutePath: oldAbs, contents: "old body" });
  await writeMarkdownFile({
    absolutePath: newAbs,
    contents: "new body",
    previousAbsolutePath: oldAbs,
  });
  const newStat = await stat(newAbs);
  assert.ok(newStat.isFile());
  const newBody = await readFile(newAbs, "utf8");
  assert.equal(newBody, "\uFEFFnew body");
  await assert.rejects(() => stat(oldAbs), { code: "ENOENT" });
});

test("config exposes a writable export root", () => {
  assert.ok(config.exportRoot);
  assert.ok(config.sessionPath);
});
