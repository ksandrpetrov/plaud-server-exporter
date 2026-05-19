import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CB_FILES_TREE_FOLDER_PREFIX,
  describeRecordStatus,
  filesStatsHtml,
  filesTreeFolderCallback,
  filesTreeFolderHtml,
  filesTreeRootHtml,
  formatBytes,
  formatTreeFolderItemLine,
  parseFilesTreeFolderCallback,
  parseTreeFilePickNumber,
  stripLeadingDateFromTreeTitle,
  treeListNumberPrefix,
} from "../src/telegram/messages.js";
import {
  _resetTreeBrowseStateForTests,
  setTreeBrowseState,
  treeBrowseItemAtPick,
} from "../src/telegram/treeBrowseState.js";
import {
  buildFilesTreeFolderKeyboard,
  buildFilesTreeRootKeyboard,
} from "../src/telegram/keyboards.js";
import {
  buildSyncIndexFolderPage,
  buildSyncIndexTreeRoot,
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

// ---------------------------------------------------------------------------
// Tree root: folder list view
// ---------------------------------------------------------------------------

test("buildSyncIndexTreeRoot lists folders sorted with Unfiled/Trash last", () => {
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

  const root = buildSyncIndexTreeRoot(syncIndex, {
    vaultRoot: "/vault",
    subfolder: "Plaud",
  });

  assert.equal(root.total, 4);
  assert.deepEqual(
    root.folders.map((f) => f.folder),
    ["Clients", "Work", PLAUD_FOLDER_UNFILED, PLAUD_FOLDER_TRASH]
  );
  assert.deepEqual(
    root.folders.map((f) => f.count),
    [1, 1, 1, 1]
  );

  const html = filesTreeRootHtml(root);
  assert.match(html, /Дерево синка/);
  assert.match(html, /Всего файлов: 4, папок: 4/);
  assert.match(html, /<b>Work<\/b>/);
  assert.match(html, /<b>Clients<\/b>/);
  assert.match(html, /<b>Unfiled<\/b>/);
  assert.match(html, /<b>Trash<\/b>/);
  assert.match(html, /Выбери папку/);
});

test("buildSyncIndexTreeRoot returns empty root for missing records", () => {
  const root = buildSyncIndexTreeRoot(null);
  assert.equal(root.total, 0);
  assert.deepEqual(root.folders, []);
  assert.equal(filesTreeRootHtml(root), filesTreeRootHtml({ total: 0, folders: [] }));
});

test("buildSyncIndexTreeRoot falls back to Unfiled when summaryPath is missing", () => {
  const root = buildSyncIndexTreeRoot(
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
  assert.equal(root.folders.length, 1);
  assert.equal(root.folders[0].folder, PLAUD_FOLDER_UNFILED);
});

test("buildSyncIndexTreeRoot maps legacy Plaud/2026 paths to Unfiled", () => {
  const root = buildSyncIndexTreeRoot(
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
  assert.equal(root.folders[0].folder, PLAUD_FOLDER_UNFILED);
});

// ---------------------------------------------------------------------------
// Tree folder page: drill-down view with pagination
// ---------------------------------------------------------------------------

function recordsAcrossFolders() {
  const records = {};
  for (let i = 0; i < 25; i++) {
    const minute = String(i).padStart(2, "0");
    records[`w-${i}`] = {
      title: `Work ${i}`,
      status: "success",
      summaryPath: `/vault/Plaud/Work/2026-05-19 - Work ${i}.md`,
      lastSyncedAt: `2026-05-19T12:${minute}:00.000Z`,
    };
  }
  for (let i = 0; i < 3; i++) {
    records[`c-${i}`] = {
      title: `Client ${i}`,
      status: "success",
      summaryPath: `/vault/Plaud/Clients/2026-04-${String(i + 1).padStart(2, "0")} - Client ${i}.md`,
      lastSyncedAt: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
    };
  }
  return records;
}

test("buildSyncIndexFolderPage paginates files inside one folder", () => {
  const records = recordsAcrossFolders();
  const ctx = { vaultRoot: "/vault", subfolder: "Plaud" };

  const root = buildSyncIndexTreeRoot({ records }, ctx);
  // Folder order: ["Clients", "Work"] (alphabetic). Work is index 1.
  const workIdx = root.folders.findIndex((f) => f.folder === "Work");
  assert.ok(workIdx >= 0);

  const page1 = buildSyncIndexFolderPage(
    { records },
    { folderIndex: workIdx, page: 1, pageSize: 10, ...ctx }
  );
  const page2 = buildSyncIndexFolderPage(
    { records },
    { folderIndex: workIdx, page: 2, pageSize: 10, ...ctx }
  );
  const page3 = buildSyncIndexFolderPage(
    { records },
    { folderIndex: workIdx, page: 3, pageSize: 10, ...ctx }
  );

  assert.equal(page1.folder, "Work");
  assert.equal(page1.exists, true);
  assert.equal(page1.total, 25);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.items.length, 10);
  assert.equal(page2.items.length, 10);
  assert.equal(page3.items.length, 5);

  const titles = (p) => p.items.map((it) => it.title);
  const overlap = (a, b) => a.filter((x) => b.includes(x));
  assert.deepEqual(overlap(titles(page1), titles(page2)), []);
  assert.deepEqual(overlap(titles(page2), titles(page3)), []);
  assert.equal(new Set([...titles(page1), ...titles(page2), ...titles(page3)]).size, 25);

  // Other folders' items don't leak in.
  for (const t of titles(page1).concat(titles(page2), titles(page3))) {
    assert.ok(t.startsWith("Work "), `unexpected item in Work folder: ${t}`);
  }

  // HTML shows page indicator + остаток.
  assert.match(filesTreeFolderHtml(page1), /стр\. 1 из 3/);
  assert.match(filesTreeFolderHtml(page1), /ещё 15/);
  assert.doesNotMatch(filesTreeFolderHtml(page3), /ещё \d+/);

  const html1 = filesTreeFolderHtml(page1);
  assert.match(html1, /^1 - .+ \| .+$/m);
  assert.match(html1, /^10 - .+ \| .+$/m);
  assert.doesNotMatch(html1, /\[ok\]/);
  assert.doesNotMatch(html1, /:one:|:ten:/);
  assert.doesNotMatch(html1, / {2}• /);
});

test("formatTreeFolderItemLine avoids duplicate date and uses pipe separator", () => {
  assert.equal(
    formatTreeFolderItemLine({
      lineNum: 1,
      date: "2026-04-20",
      title: "2026-04-20 | SocServ | QA | Leads",
    }),
    "1 - 2026-04-20 | SocServ | QA | Leads"
  );
  assert.equal(
    formatTreeFolderItemLine({
      lineNum: 2,
      date: "2026-05-19",
      title: "2026-05-19 - Work standup",
    }),
    "2 - 2026-05-19 | Work standup"
  );
  assert.equal(
    formatTreeFolderItemLine({
      lineNum: 3,
      date: "2026-05-19",
      title: "Work standup",
    }),
    "3 - 2026-05-19 | Work standup"
  );
  assert.equal(
    formatTreeFolderItemLine({
      lineNum: 4,
      date: "2026-04-20",
      title: "2026-04-20",
    }),
    "4 - 2026-04-20"
  );
});

test("stripLeadingDateFromTreeTitle", () => {
  assert.equal(
    stripLeadingDateFromTreeTitle("2026-04-20", "2026-04-20 | SocServ | QA"),
    "SocServ | QA"
  );
  assert.equal(stripLeadingDateFromTreeTitle("2026-04-20", "2026-04-20"), "");
  assert.equal(stripLeadingDateFromTreeTitle("2026-04-20", "Standup"), "Standup");
});

test("treeListNumberPrefix and parseTreeFilePickNumber", () => {
  assert.equal(treeListNumberPrefix(1), "1 -");
  assert.equal(treeListNumberPrefix(2), "2 -");
  assert.equal(treeListNumberPrefix(10), "10 -");
  assert.equal(treeListNumberPrefix(20), "20 -");
  assert.equal(treeListNumberPrefix(21), "21 -");
  assert.equal(treeListNumberPrefix(0), "");

  assert.equal(parseTreeFilePickNumber("1"), 1);
  assert.equal(parseTreeFilePickNumber("  3  "), null);
  assert.equal(parseTreeFilePickNumber("3"), 3);
  assert.equal(parseTreeFilePickNumber("abc"), null);
  assert.equal(parseTreeFilePickNumber("1 extra"), null);
});

test("treeBrowseItemAtPick resolves item by 1-based index on current page", async () => {
  _resetTreeBrowseStateForTests();
  const items = [
    {
      title: "First",
      summaryPath: "/vault/a.md",
      date: "2026-01-01",
      status: "success",
      lastSyncedAt: "",
      folder: "Work",
      stableId: "plaud:1",
    },
    {
      title: "Second",
      summaryPath: "/vault/b.md",
      date: "2026-01-02",
      status: "success",
      lastSyncedAt: "",
      folder: "Work",
      stableId: "plaud:2",
    },
  ];
  await setTreeBrowseState(42, { folderIndex: 0, page: 1, items });
  assert.equal(treeBrowseItemAtPick({ items }, 1)?.summaryPath, "/vault/a.md");
  assert.equal(treeBrowseItemAtPick({ items }, 2)?.title, "Second");
  assert.equal(treeBrowseItemAtPick({ items }, 3), null);
  _resetTreeBrowseStateForTests();
});

test("buildSyncIndexFolderPage resolves folder by name and by index equivalently", () => {
  const records = recordsAcrossFolders();
  const ctx = { vaultRoot: "/vault", subfolder: "Plaud" };
  const byName = buildSyncIndexFolderPage(
    { records },
    { folder: "Clients", page: 1, pageSize: 10, ...ctx }
  );
  const byIndex = buildSyncIndexFolderPage(
    { records },
    { folderIndex: 0, page: 1, pageSize: 10, ...ctx }
  );
  assert.equal(byName.folder, "Clients");
  assert.equal(byIndex.folder, "Clients");
  assert.equal(byName.total, byIndex.total);
  assert.deepEqual(
    byName.items.map((i) => i.title),
    byIndex.items.map((i) => i.title)
  );
});

test("buildSyncIndexFolderPage clamps out-of-range pages and signals missing folders", () => {
  const records = recordsAcrossFolders();
  const ctx = { vaultRoot: "/vault", subfolder: "Plaud" };

  const tooLow = buildSyncIndexFolderPage(
    { records },
    { folder: "Work", page: 0, pageSize: 10, ...ctx }
  );
  const tooHigh = buildSyncIndexFolderPage(
    { records },
    { folder: "Work", page: 99, pageSize: 10, ...ctx }
  );
  assert.equal(tooLow.page, 1);
  assert.equal(tooHigh.page, 3);

  const missing = buildSyncIndexFolderPage(
    { records },
    { folder: "NoSuchFolder", page: 1, ...ctx }
  );
  assert.equal(missing.exists, false);
  assert.equal(missing.folderIndex, -1);
  assert.equal(missing.items.length, 0);
});

// ---------------------------------------------------------------------------
// Callback encoding for the drill-down keyboard
// ---------------------------------------------------------------------------

test("filesTreeFolderCallback round-trips and parseFilesTreeFolderCallback rejects junk", () => {
  assert.equal(filesTreeFolderCallback(2, 5), `${CB_FILES_TREE_FOLDER_PREFIX}2:5`);
  assert.deepEqual(parseFilesTreeFolderCallback(filesTreeFolderCallback(0, 1)), {
    folderIndex: 0,
    page: 1,
  });
  assert.equal(parseFilesTreeFolderCallback("files_tree"), null);
  assert.equal(parseFilesTreeFolderCallback(`${CB_FILES_TREE_FOLDER_PREFIX}abc:1`), null);
  assert.equal(parseFilesTreeFolderCallback(`${CB_FILES_TREE_FOLDER_PREFIX}1`), null);
  assert.equal(parseFilesTreeFolderCallback(`${CB_FILES_TREE_FOLDER_PREFIX}1:0`), null);
  assert.equal(parseFilesTreeFolderCallback(""), null);
});

test("buildFilesTreeRootKeyboard renders one button per folder + back to menu", () => {
  const root = {
    total: 3,
    folders: [
      { folder: "Clients", count: 2 },
      { folder: "Work", count: 1 },
    ],
  };
  const kb = buildFilesTreeRootKeyboard(root);
  assert.equal(kb.inline_keyboard.length, 3);
  assert.match(kb.inline_keyboard[0][0].text, /Clients \(2\)/);
  assert.equal(kb.inline_keyboard[0][0].callback_data, filesTreeFolderCallback(0, 1));
  assert.match(kb.inline_keyboard[1][0].text, /Work \(1\)/);
  assert.equal(kb.inline_keyboard[1][0].callback_data, filesTreeFolderCallback(1, 1));
  assert.equal(kb.inline_keyboard[2][0].callback_data, "back");
});

test("buildFilesTreeFolderKeyboard shows prev/next + К папкам + В меню", () => {
  const single = buildFilesTreeFolderKeyboard({
    folderIndex: 0,
    page: 1,
    totalPages: 1,
  });
  // Single page: just the [К папкам] [В меню] row.
  assert.equal(single.inline_keyboard.length, 1);
  assert.equal(single.inline_keyboard[0][0].callback_data, "files_tree");
  assert.equal(single.inline_keyboard[0][1].callback_data, "back");

  const first = buildFilesTreeFolderKeyboard({
    folderIndex: 2,
    page: 1,
    totalPages: 3,
  });
  const firstNav = first.inline_keyboard[0];
  assert.equal(firstNav.length, 1);
  assert.equal(firstNav[0].callback_data, filesTreeFolderCallback(2, 2));
  assert.match(firstNav[0].text, /След/);

  const middle = buildFilesTreeFolderKeyboard({
    folderIndex: 2,
    page: 2,
    totalPages: 3,
  });
  const middleNav = middle.inline_keyboard[0];
  assert.equal(middleNav.length, 2);
  assert.equal(middleNav[0].callback_data, filesTreeFolderCallback(2, 1));
  assert.equal(middleNav[1].callback_data, filesTreeFolderCallback(2, 3));

  const last = buildFilesTreeFolderKeyboard({
    folderIndex: 2,
    page: 3,
    totalPages: 3,
  });
  const lastNav = last.inline_keyboard[0];
  assert.equal(lastNav.length, 1);
  assert.equal(lastNav[0].callback_data, filesTreeFolderCallback(2, 2));
  assert.match(lastNav[0].text, /Пред/);
});

// ---------------------------------------------------------------------------
// Vault filesystem summary (unchanged behaviour, kept for regression)
// ---------------------------------------------------------------------------

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
