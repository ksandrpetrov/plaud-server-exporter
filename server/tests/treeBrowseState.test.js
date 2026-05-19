/**
 * Verifies that tree browse state survives a "bot restart" — i.e. when the
 * in-memory cache is cleared, the next read still picks the matching `.md`
 * because the state was persisted to disk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "tree-browse-state-"));
const statePath = join(dir, "tree-browse.json");
process.env.PLAUD_TREE_BROWSE_PATH = statePath;

const {
  _resetTreeBrowseStateForTests,
  clearTreeBrowseState,
  getTreeBrowseState,
  setTreeBrowseState,
  treeBrowseItemAtPick,
} = await import("../src/telegram/treeBrowseState.js");

function sampleItems() {
  return [
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
}

test("setTreeBrowseState persists to disk, getTreeBrowseState reads after cache reset", async () => {
  _resetTreeBrowseStateForTests();
  const items = sampleItems();
  await setTreeBrowseState(42, { folderIndex: 0, page: 2, items });

  const text = await readFile(statePath, "utf8");
  const parsed = JSON.parse(text);
  assert.ok(parsed?.byChatId?.[42], "state file contains chat 42");

  _resetTreeBrowseStateForTests();
  const restored = await getTreeBrowseState(42);
  assert.ok(restored, "state survives an in-memory reset");
  assert.equal(restored.folderIndex, 0);
  assert.equal(restored.page, 2);
  assert.equal(treeBrowseItemAtPick(restored, 1)?.title, "First");
  assert.equal(treeBrowseItemAtPick(restored, 2)?.summaryPath, "/vault/b.md");

  await clearTreeBrowseState(42);
  assert.equal(await getTreeBrowseState(42), null);
});

test("stale entries past TTL are dropped on read", async () => {
  _resetTreeBrowseStateForTests();
  await writeFile(
    statePath,
    JSON.stringify({
      byChatId: {
        99: {
          folderIndex: 1,
          page: 1,
          items: sampleItems(),
          updatedAtMs: 0,
        },
      },
    }),
    "utf8"
  );

  const stale = await getTreeBrowseState(99);
  assert.equal(stale, null);
});
