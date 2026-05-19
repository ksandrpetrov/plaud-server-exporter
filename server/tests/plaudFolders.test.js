import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTagByIdMap,
  collectUnfiledFiletagIds,
  extractFiletagIdsFromRaw,
  resolveFolderPathSegment,
} from "../src/plaud/plaudFolders.js";

test("extractFiletagIdsFromRaw reads filetag_id_list", () => {
  assert.deepEqual(
    extractFiletagIdsFromRaw({
      file_id: "abc",
      filetag_id_list: ["tag-work", "tag-inbox"],
    }),
    ["tag-work", "tag-inbox"]
  );
});

test("collectUnfiledFiletagIds recognizes unfiled folder names", () => {
  const ids = collectUnfiledFiletagIds([
    { id: "t1", name: "Work" },
    { id: "t2", name: "Unfiled", is_unfiled: true },
    { id: "t3", name: "Без папки" },
  ]);
  assert.ok(ids.includes("t2"));
  assert.ok(ids.includes("t3"));
  assert.ok(!ids.includes("t1"));
});

test("resolveFolderPathSegment prefers a named folder over unfiled", () => {
  const tagById = buildTagByIdMap([
    { id: "t-work", name: "Client calls" },
    { id: "t-inbox", name: "Unfiled", is_unfiled: true },
  ]);
  const unfiledIds = new Set(collectUnfiledFiletagIds([...tagById.values()]));
  assert.equal(
    resolveFolderPathSegment(["t-inbox", "t-work"], tagById, unfiledIds),
    "Client calls"
  );
});

test("resolveFolderPathSegment uses unfiled label when only unfiled tags", () => {
  const tagById = buildTagByIdMap([{ id: "t-inbox", name: "Unfiled", is_unfiled: true }]);
  const unfiledIds = new Set(["t-inbox"]);
  assert.equal(
    resolveFolderPathSegment(["t-inbox"], tagById, unfiledIds),
    "Unfiled"
  );
});
