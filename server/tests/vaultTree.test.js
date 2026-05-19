import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  describeRecordStatus,
  filesStatsHtml,
  filesTreeHtml,
  formatBytes,
} from "../src/telegram/messages.js";
import {
  buildSyncIndexTree,
  parseSummaryFilename,
  scanVaultSummary,
} from "../src/telegram/vaultTree.js";

test("parseSummaryFilename extracts date, title, year", () => {
  const parsed = parseSummaryFilename("/vault/Plaud/2026-05-19 - Standup.md");
  assert.deepEqual(parsed, {
    date: "2026-05-19",
    title: "Standup",
    year: "2026",
  });
  assert.equal(parseSummaryFilename("not-a-md.txt"), null);
});

test("buildSyncIndexTree groups records by year and sorts newest first", () => {
  const syncIndex = {
    records: {
      a: {
        title: "Old meeting",
        status: "success",
        summaryPath: "/vault/Plaud/2025-01-10 - Old meeting.md",
        lastSyncedAt: "2025-01-10T10:00:00.000Z",
      },
      b: {
        title: "Recent",
        status: "updated",
        normalizedFilename: "2026-05-19 - Recent.md",
        lastSyncedAt: "2026-05-19T14:00:00.000Z",
      },
      c: {
        title: "Fallback title",
        status: "skipped",
        lastSyncedAt: "2024-06-01T08:00:00.000Z",
      },
    },
  };

  const tree = buildSyncIndexTree(syncIndex);
  assert.equal(tree.total, 3);
  assert.equal(tree.truncated, false);
  assert.ok(tree.groups.length >= 2);

  const firstItem = tree.groups[0]?.items?.[0];
  assert.equal(firstItem?.title, "Recent");
  assert.equal(firstItem?.date, "2026-05-19");

  const html = filesTreeHtml(tree);
  assert.match(html, /Дерево синка/);
  assert.match(html, /всего 3/);
  assert.match(html, /Recent/);
});

test("buildSyncIndexTree returns empty tree for missing records", () => {
  const tree = buildSyncIndexTree(null);
  assert.equal(tree.total, 0);
  assert.deepEqual(tree.groups, []);
  assert.equal(filesTreeHtml(tree), filesTreeHtml({ total: 0, groups: [], truncated: false }));
});

test("buildSyncIndexTree truncates when over maxRows", () => {
  const records = {};
  for (let i = 0; i < 40; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    records[`id-${i}`] = {
      title: `Meeting ${i}`,
      status: "success",
      normalizedFilename: `2026-05-${day} - Meeting ${i}.md`,
      lastSyncedAt: `2026-05-${day}T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
    };
  }
  const tree = buildSyncIndexTree({ records }, { maxRows: 10 });
  assert.equal(tree.total, 40);
  assert.equal(tree.truncated, true);
  const shown = tree.groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(shown, 10);

  const html = filesTreeHtml(tree);
  assert.match(html, /ещё 30/);
});

test("scanVaultSummary counts md files and lists recent by mtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-vault-"));
  const plaudDir = join(root, "Plaud", "2026");
  await mkdir(plaudDir, { recursive: true });

  const paths = [
    join(plaudDir, "2026-05-01 - First.md"),
    join(plaudDir, "2026-05-02 - Second.md"),
    join(plaudDir, "2026-05-03 - Third.md"),
  ];
  await writeFile(paths[0], "# one\n", "utf8");
  await writeFile(paths[1], "# two\n\nmore", "utf8");
  await writeFile(paths[2], "# three\n", "utf8");

  const stats = await scanVaultSummary({
    vaultRoot: root,
    subfolder: "Plaud",
  });

  assert.equal(stats.exists, true);
  assert.equal(stats.totalCount, 3);
  assert.ok(stats.totalBytes > 0);
  assert.ok(stats.lastMtime);
  assert.equal(stats.recent.length, 3);
  assert.ok(
    stats.recent[0].relativePath.startsWith("Plaud/"),
    "paths are relative to vault root"
  );
  assert.ok(!stats.recent[0].relativePath.startsWith("/"));

  const html = filesStatsHtml(stats);
  assert.match(html, /Сводка vault/);
  assert.match(html, /Файлов .md: 3/);
});

test("scanVaultSummary returns exists=false when vault subfolder is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-missing-"));
  const stats = await scanVaultSummary({
    vaultRoot: root,
    subfolder: "Plaud",
  });
  assert.equal(stats.exists, false);
  assert.equal(stats.totalCount, 0);
  assert.equal(filesStatsHtml(stats), filesStatsHtml({ exists: false }));
});

test("formatBytes and describeRecordStatus", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(describeRecordStatus("success"), "ok");
  assert.equal(describeRecordStatus("updated"), "обновлён");
  assert.equal(describeRecordStatus("error"), "ошибка");
});
