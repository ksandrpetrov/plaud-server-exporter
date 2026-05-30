import assert from "node:assert/strict";
import test from "node:test";
import {
  attachFolderSegmentsToFiles,
  buildTagByIdMap,
  collectAllFilesFiletagIds,
  collectUnfiledFiletagIds,
  extractFiletagIdsFromRaw,
  isAllFilesMetaTag,
  isRecordingInTrash,
  PLAUD_FOLDER_TRASH,
  PLAUD_FOLDER_UNFILED,
  resolveFileFolderSegment,
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

test("resolveFolderPathSegment defaults to Unfiled without tags", () => {
  const tagById = buildTagByIdMap([]);
  assert.equal(
    resolveFolderPathSegment([], tagById, new Set()),
    PLAUD_FOLDER_UNFILED
  );
});

test("resolveFileFolderSegment maps trash recordings to Trash", () => {
  const tagById = buildTagByIdMap([{ id: "t-work", name: "SocServ QA" }]);
  assert.ok(isRecordingInTrash({ is_trash: 1 }));
  assert.equal(
    resolveFileFolderSegment({
      folderIds: ["t-work"],
      raw: { is_trash: "1" },
      tagById,
      unfiledIds: new Set(),
    }),
    PLAUD_FOLDER_TRASH
  );
});

test("resolveFileFolderSegment maps user folders by tag name", () => {
  const tagById = buildTagByIdMap([
    { id: "t-dev", name: "SocServ Dev" },
    { id: "t-qa", name: "SocServ QA" },
  ]);
  assert.equal(
    resolveFileFolderSegment({
      folderIds: ["t-qa"],
      raw: { is_trash: "0", filetag_id_list: ["t-qa"] },
      tagById,
      unfiledIds: new Set(),
    }),
    "SocServ QA"
  );
});

test("resolveFileFolderSegment ignores fan-out folderIds when raw has no tags", () => {
  const tagById = buildTagByIdMap([
    { id: "t-dev", name: "SocServ Dev" },
    { id: "t-qa", name: "SocServ QA" },
  ]);
  assert.equal(
    resolveFileFolderSegment({
      folderIds: ["t-dev", "t-qa"],
      raw: { file_id: "abc", is_trash: "0" },
      tagById,
      unfiledIds: new Set(),
    }),
    PLAUD_FOLDER_UNFILED
  );
});

test("isAllFilesMetaTag matches English All files sidebar tag", () => {
  assert.equal(isAllFilesMetaTag({ name: "All files" }), true);
  assert.equal(isAllFilesMetaTag({ name: "Work" }), false);
});

test("resolveFolderPathSegment maps only All files tag to Unfiled", () => {
  const tags = [{ id: "t-all", name: "All files", system_folder_type: "all" }];
  const tagById = buildTagByIdMap(tags);
  const unfiledIds = new Set();
  const allFilesIds = new Set(collectAllFilesFiletagIds(tags));
  assert.equal(
    resolveFolderPathSegment(["t-all"], tagById, unfiledIds, allFilesIds),
    PLAUD_FOLDER_UNFILED
  );
});

test("attachFolderSegmentsToFiles maps only All files tag to Unfiled", () => {
  const files = [{ id: "f-1", folderIds: ["t-all"], raw: {} }];
  const tags = [{ id: "t-all", name: "All files", system_folder_type: "all" }];
  attachFolderSegmentsToFiles(files, tags);
  assert.equal(files[0].folderSegment, PLAUD_FOLDER_UNFILED);
});
