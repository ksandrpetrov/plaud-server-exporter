import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PLAUD_TIMEZONE = "UTC";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-filename-"));
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");

const {
  resolveMeetingTitle,
  planSummaryPath,
  buildDatedFilenameBase,
  collectOccupiedFilenames,
  fitsPathLengthBudget,
} = await import("../src/sync/filenamePlanner.js");
const { MAX_FILENAME_WITH_EXTENSION, MARKDOWN_EXTENSION } =
  await import("../../plaud-exporter/common/exportPathUtils.js");

test("resolveMeetingTitle prefers Plaud metadata over boilerplate", () => {
  assert.equal(
    resolveMeetingTitle({
      plaudTitle: "Архитектура синхронизации",
      summaries: [{ markdown: "# Plaud Web\n\n# Real title\n" }],
    }),
    "Архитектура синхронизации"
  );
});

test("resolveMeetingTitle falls back to markdown heading", () => {
  assert.equal(
    resolveMeetingTitle({
      plaudTitle: "Untitled",
      summaries: [{ markdown: "# Plaud Web\n\n# Customer onboarding\n\nBody" }],
      createdAt: "2026-05-18T10:00:00.000Z",
    }),
    "Customer onboarding"
  );
});

test("resolveMeetingTitle uses date fallback when title missing", () => {
  assert.match(
    resolveMeetingTitle({
      plaudTitle: "Plaud",
      summaries: [{ markdown: "# Plaud Web\n\nBody only" }],
      createdAt: "2026-05-18T10:00:00.000Z",
    }),
    /^2026-05-18 Plaud summary$/
  );
});

test("planSummaryPath sanitizes forbidden characters and reserved Windows names", () => {
  const planned = planSummaryPath({
    title: "CON: bad <name>|?",
    createdAt: "2026-05-17T12:00:00.000Z",
  });
  assert.match(planned.filename, /^2026-05-17 - /);
  assert.match(planned.filename, /\.md$/);
  assert.ok(!/[:<>|?]/.test(planned.filename));
  assert.match(planned.filename, /CON/);
});

test("long Russian and English titles are truncated safely", () => {
  const ru = "О".repeat(400);
  const en = "A".repeat(400);
  for (const title of [ru, en, `${ru} ${en} 🎧`]) {
    const { base } = buildDatedFilenameBase({
      title,
      createdAt: "2026-05-17T12:00:00.000Z",
    });
    const filename = `${base}${MARKDOWN_EXTENSION}`;
    assert.ok(filename.length <= MAX_FILENAME_WITH_EXTENSION, filename.length);
    assert.ok(filename.endsWith(".md"));
  }
});

test("fitsPathLengthBudget enforces conservative full-path limit", () => {
  const short = join(tmpRoot, "exports", "Plaud", "a.md");
  const long = join(tmpRoot, "x".repeat(300), "Plaud", "a.md");
  assert.equal(fitsPathLengthBudget(short), true);
  assert.equal(fitsPathLengthBudget(long), false);
});

test("planSummaryPath shortens title when vault path is very long", () => {
  const deepVault = join(tmpRoot, "deep-vault", "x".repeat(90));
  const prevVault = process.env.PLAUD_OBSIDIAN_VAULT_PATH;
  process.env.PLAUD_OBSIDIAN_VAULT_PATH = deepVault;
  try {
    const planned = planSummaryPath({
      title: "Очень длинное название встречи про архитектуру синхронизации",
      createdAt: "2026-05-17T12:00:00.000Z",
    });
    assert.ok(
      fitsPathLengthBudget(planned.absolutePath),
      planned.absolutePath.length
    );
    assert.ok(planned.absolutePath.startsWith(deepVault));
  } finally {
    if (prevVault === undefined) delete process.env.PLAUD_OBSIDIAN_VAULT_PATH;
    else process.env.PLAUD_OBSIDIAN_VAULT_PATH = prevVault;
  }
});

test("collision of same titles uses distinct filenames", () => {
  const syncIndex = {
    records: {
      "plaud:aaa": { normalizedFilename: "2026-05-17 - Weekly review.md" },
    },
  };
  const occupied = collectOccupiedFilenames(syncIndex, "plaud:bbb");
  const planned = planSummaryPath({
    title: "Weekly review",
    createdAt: "2026-05-17T12:00:00.000Z",
    occupiedFilenames: occupied,
    stableId: "plaud:bbb",
  });
  assert.notEqual(planned.filename, "2026-05-17 - Weekly review.md");
  assert.match(planned.filename, /\.md$/);
});

test("planSummaryPath nests under folder segment when provided", () => {
  const planned = planSummaryPath({
    title: "Weekly review",
    createdAt: "2026-05-17T12:00:00.000Z",
    folderSegment: "Client calls",
  });
  assert.match(planned.relativePath, /Plaud[\\/]Client calls[\\/]/);
  assert.match(planned.filename, /^2026-05-17 - Weekly review\.md$/);
});

test("planSummaryPath nests Unfiled recordings under Plaud/Unfiled/", () => {
  const planned = planSummaryPath({
    title: "Inbox note",
    createdAt: "2026-05-17T12:00:00.000Z",
    folderSegment: "Unfiled",
  });
  assert.match(planned.relativePath, /Plaud[\\/]Unfiled[\\/]/);
  assert.match(planned.filename, /^2026-05-17 - Inbox note\.md$/);
});

test("planSummaryPath preserves emoji/unicode title and ends with .md", () => {
  const planned = planSummaryPath({
    title: "Команда 🎧 Retrospective — Q2 ✅",
    createdAt: "2026-05-17T12:00:00.000Z",
  });
  assert.match(planned.filename, /\.md$/);
  assert.match(planned.filename, /🎧/);
  assert.match(planned.filename, /Команда/);
});

test("planSummaryPath escapes Windows reserved names (COM1, LPT1, NUL)", () => {
  for (const reserved of ["COM1", "LPT1", "NUL", "AUX", "PRN"]) {
    const planned = planSummaryPath({
      title: reserved,
      createdAt: "2026-05-17T12:00:00.000Z",
    });
    assert.match(planned.filename, /\.md$/);
    // The basename without extension must NOT equal the reserved name.
    const stem = planned.filename.replace(/\.md$/, "");
    assert.notEqual(stem.split(" - ").pop().toUpperCase(), reserved);
  }
});

test("planSummaryPath fits cross-platform basename budget", () => {
  // Conservative target: 5% under 255 = 242 chars (incl. .md).
  const planned = planSummaryPath({
    title: "A".repeat(800),
    createdAt: "2026-05-17T12:00:00.000Z",
  });
  assert.ok(
    planned.filename.length <= MAX_FILENAME_WITH_EXTENSION,
    planned.filename.length
  );
  assert.match(planned.filename, /\.md$/);
});
