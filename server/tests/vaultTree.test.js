import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CB_FILES_TREE_PAGE_PREFIX,
  describeRecordStatus,
  filesStatsHtml,
  filesTreeHtml,
  filesTreePageCallback,
  formatBytes,
  parseFilesTreePageCallback,
} from "../src/telegram/messages.js";
import { buildFilesTreeKeyboard } from "../src/telegram/keyboards.js";
import {
  buildSyncIndexTree,
  comparePlaudFolderLabels,
  parseSummaryFilename,
  plaudFolderLabelFromVaultPath,
  scanVaultSummary,
} from "../src/telegram/vaultTree.js";
import {
  PLAUD_FOLDER_TRASH,
  PLAUD_FOLDER_UNFILED,
} from "../src/plaud/plaudFolders.js";

test("parseSummaryFilename extracts date, title, year", () => {
  const parsed = parseSummaryFilename("/vault/Plaud/2026-05-19 - Standup.md");
  assert.deepEqual(parsed, {
    date: "2026-05-19",
    title: "Standup",
    year: "2026",
  });
  assert.equal(parseSummaryFilename("not-a-md.txt"), null);
});

test("plaudFolderLabelFromVaultPath maps legacy year dirs to Unfiled", () => {
  assert.equal(plaudFolderLabelFromVaultPath("Plaud/2026", "Plaud"), PLAUD_FOLDER_UNFILED);
  assert.equal(plaudFolderLabelFromVaultPath("Plaud/SocServ QA", "Plaud"), "SocServ QA");
});

test("comparePlaudFolderLabels sorts Unfiled and Trash last", () => {
  const labels = ["Trash", "SocServ QA", "Unfiled", "SocServ Dev"].sort(
    comparePlaudFolderLabels
  );
  assert.deepEqual(labels, ["SocServ Dev", "SocServ QA", "Unfiled", "Trash"]);
});

test("buildSyncIndexTree groups by Plaud folder labels", () => {
  const syncIndex = {
    records: {
      a: {
        title: "Old meeting",
        status: "success",
        folderSegment: PLAUD_FOLDER_UNFILED,
        summaryPath: "/vault/Plaud/2025-01-10 - Old meeting.md",
        lastSyncedAt: "2025-01-10T10:00:00.000Z",
      },
      b: {
        title: "Work standup",
        status: "updated",
        folderSegment: "Work",
        summaryPath: "/vault/Plaud/Work/2026-05-19 - Work standup.md",
        lastSyncedAt: "2026-05-19T14:00:00.000Z",
      },
      c: {
        title: "Customer call",
        status: "success",
        folderSegment: "Clients",
        summaryPath: "/vault/Plaud/Clients/2026-04-01 - Customer call.md",
        lastSyncedAt: "2026-04-01T08:00:00.000Z",
      },
      d: {
        title: "Trashed call",
        status: "skipped",
        folderSegment: PLAUD_FOLDER_TRASH,
        lastSyncedAt: "2024-06-01T08:00:00.000Z",
      },
    },
  };

  const tree = buildSyncIndexTree(syncIndex, {
    vaultRoot: "/vault",
    subfolder: "Plaud",
  });

  assert.equal(tree.total, 4);
  assert.equal(tree.truncated, false);

  const folders = tree.groups.map((g) => g.folder);
  assert.deepEqual(folders, ["Clients", "Work", PLAUD_FOLDER_UNFILED, PLAUD_FOLDER_TRASH]);

  const unfiledGroup = tree.groups.find((g) => g.folder === PLAUD_FOLDER_UNFILED);
  assert.equal(unfiledGroup?.items?.[0]?.title, "Old meeting");

  const workGroup = tree.groups.find((g) => g.folder === "Work");
  assert.equal(workGroup?.items?.[0]?.title, "Work standup");

  const html = filesTreeHtml(tree);
  assert.match(html, /Дерево синка/);
  assert.match(html, /всего 4/);
  assert.match(html, /<b>Work<\/b>/);
  assert.match(html, /<b>Clients<\/b>/);
  assert.match(html, /<b>Unfiled<\/b>/);
  assert.match(html, /<b>Trash<\/b>/);
  assert.match(html, /Work standup/);
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
    const vaultSub = i % 2 === 0 ? "Plaud" : "Plaud/Work";
    records[`id-${i}`] = {
      title: `Meeting ${i}`,
      status: "success",
      summaryPath: `/vault/${vaultSub}/2026-05-${day} - Meeting ${i}.md`,
      normalizedFilename: `2026-05-${day} - Meeting ${i}.md`,
      lastSyncedAt: `2026-05-${day}T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
    };
  }
  const tree = buildSyncIndexTree(
    { records },
    { maxRows: 10, vaultRoot: "/vault", subfolder: "Plaud" }
  );
  assert.equal(tree.total, 40);
  assert.equal(tree.truncated, true);
  assert.equal(tree.page, 1);
  assert.equal(tree.pageSize, 10);
  assert.equal(tree.totalPages, 4);
  const shown = tree.groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(shown, 10);

  const html = filesTreeHtml(tree);
  assert.match(html, /ещё 30/);
});

test("buildSyncIndexTree paginates and shows distinct items per page", () => {
  const records = {};
  // Build 25 records with strictly descending lastSyncedAt so order is stable.
  for (let i = 0; i < 25; i++) {
    const minute = String(i).padStart(2, "0");
    records[`id-${i}`] = {
      title: `Meeting ${i}`,
      status: "success",
      summaryPath: `/vault/Plaud/Work/2026-05-19 - Meeting ${i}.md`,
      lastSyncedAt: `2026-05-19T12:${minute}:00.000Z`,
    };
  }

  const page1 = buildSyncIndexTree(
    { records },
    { pageSize: 10, page: 1, vaultRoot: "/vault", subfolder: "Plaud" }
  );
  const page2 = buildSyncIndexTree(
    { records },
    { pageSize: 10, page: 2, vaultRoot: "/vault", subfolder: "Plaud" }
  );
  const page3 = buildSyncIndexTree(
    { records },
    { pageSize: 10, page: 3, vaultRoot: "/vault", subfolder: "Plaud" }
  );

  assert.equal(page1.totalPages, 3);
  assert.equal(page1.page, 1);
  assert.equal(page2.page, 2);
  assert.equal(page3.page, 3);

  const itemsOn = (tree) => tree.groups.flatMap((g) => g.items.map((it) => it.title));
  const titles1 = itemsOn(page1);
  const titles2 = itemsOn(page2);
  const titles3 = itemsOn(page3);

  assert.equal(titles1.length, 10);
  assert.equal(titles2.length, 10);
  assert.equal(titles3.length, 5);

  // No overlap across pages.
  const overlap = (a, b) => a.filter((x) => b.includes(x));
  assert.deepEqual(overlap(titles1, titles2), []);
  assert.deepEqual(overlap(titles2, titles3), []);

  // Union of all pages equals the total item count.
  assert.equal(new Set([...titles1, ...titles2, ...titles3]).size, 25);

  // HTML shows page indicator on multi-page trees.
  assert.match(filesTreeHtml(page1), /стр\. 1 из 3/);
  assert.match(filesTreeHtml(page2), /стр\. 2 из 3/);

  // Last page no longer advertises remaining items.
  assert.doesNotMatch(filesTreeHtml(page3), /ещё \d+/);
});

test("buildSyncIndexTree clamps out-of-range page numbers", () => {
  const records = {};
  for (let i = 0; i < 15; i++) {
    records[`id-${i}`] = {
      title: `M ${i}`,
      status: "success",
      summaryPath: `/vault/Plaud/Work/2026-05-19 - M ${i}.md`,
      lastSyncedAt: `2026-05-19T12:${String(i).padStart(2, "0")}:00.000Z`,
    };
  }
  const tooLow = buildSyncIndexTree(
    { records },
    { pageSize: 10, page: 0, vaultRoot: "/vault", subfolder: "Plaud" }
  );
  const tooHigh = buildSyncIndexTree(
    { records },
    { pageSize: 10, page: 99, vaultRoot: "/vault", subfolder: "Plaud" }
  );
  assert.equal(tooLow.page, 1);
  assert.equal(tooHigh.page, 2);
});

test("filesTreePageCallback round-trips and parseFilesTreePageCallback rejects junk", () => {
  assert.equal(filesTreePageCallback(1), `${CB_FILES_TREE_PAGE_PREFIX}1`);
  assert.equal(parseFilesTreePageCallback(filesTreePageCallback(7)), 7);
  assert.equal(parseFilesTreePageCallback("files_tree"), null);
  assert.equal(parseFilesTreePageCallback(`${CB_FILES_TREE_PAGE_PREFIX}abc`), null);
  assert.equal(parseFilesTreePageCallback(`${CB_FILES_TREE_PAGE_PREFIX}0`), null);
  assert.equal(parseFilesTreePageCallback(""), null);
});

test("buildFilesTreeKeyboard shows correct nav buttons per page", () => {
  const single = buildFilesTreeKeyboard({ page: 1, totalPages: 1 });
  assert.equal(single.inline_keyboard.length, 1);
  assert.equal(single.inline_keyboard[0][0].callback_data, "back");

  const first = buildFilesTreeKeyboard({ page: 1, totalPages: 3 });
  const firstNav = first.inline_keyboard[0];
  assert.equal(firstNav.length, 1);
  assert.equal(firstNav[0].callback_data, filesTreePageCallback(2));
  assert.match(firstNav[0].text, /След/);

  const middle = buildFilesTreeKeyboard({ page: 2, totalPages: 3 });
  const middleNav = middle.inline_keyboard[0];
  assert.equal(middleNav.length, 2);
  assert.equal(middleNav[0].callback_data, filesTreePageCallback(1));
  assert.equal(middleNav[1].callback_data, filesTreePageCallback(3));

  const last = buildFilesTreeKeyboard({ page: 3, totalPages: 3 });
  const lastNav = last.inline_keyboard[0];
  assert.equal(lastNav.length, 1);
  assert.equal(lastNav[0].callback_data, filesTreePageCallback(2));
  assert.match(lastNav[0].text, /Пред/);
});

test("buildSyncIndexTree falls back to Unfiled when summaryPath is missing", () => {
  const tree = buildSyncIndexTree(
    {
      records: {
        a: {
          title: "Legacy entry",
          status: "success",
          normalizedFilename: "2026-05-19 - Legacy.md",
          lastSyncedAt: "2026-05-19T10:00:00.000Z",
        },
      },
    },
    { vaultRoot: "/vault", subfolder: "Plaud" }
  );
  assert.equal(tree.groups.length, 1);
  assert.equal(tree.groups[0].folder, PLAUD_FOLDER_UNFILED);
});

test("buildSyncIndexTree maps legacy Plaud/2026 paths to Unfiled", () => {
  const tree = buildSyncIndexTree(
    {
      records: {
        a: {
          title: "In year folder",
          status: "success",
          summaryPath: "/vault/Plaud/2026/2026-05-01 - In year folder.md",
          lastSyncedAt: "2026-05-01T10:00:00.000Z",
        },
      },
    },
    { vaultRoot: "/vault", subfolder: "Plaud" }
  );
  assert.equal(tree.groups[0].folder, PLAUD_FOLDER_UNFILED);
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
