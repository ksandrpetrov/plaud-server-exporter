import assert from "node:assert/strict";
import test from "node:test";
import {
  attachFolderSegmentsToFiles,
  extractFiletagIdsFromRaw,
  mergeFiletagIds,
  mergeFiletagsById,
  parseFiletagListPayload,
  PLAUD_FOLDER_TRASH,
  PLAUD_FOLDER_UNFILED,
  resolveFileFolderSegment,
} from "../common/plaudFolders.js";
import { buildTagByIdMap, collectUnfiledFiletagIds } from "../common/plaudFolders.js";

test("extractFiletagIdsFromRaw merges every known key alias and dedupes", () => {
  const ids = extractFiletagIdsFromRaw({
    filetag_id_list: ["t-1", "t-2"],
    tag_ids: ["t-2", "t-3"],
    folder_id: "t-4",
    tags: [{ id: "t-5" }, "t-1", 42],
  });
  assert.deepEqual(ids.sort(), ["42", "t-1", "t-2", "t-3", "t-4", "t-5"]);
});

test("extractFiletagIdsFromRaw returns [] for non-object input", () => {
  assert.deepEqual(extractFiletagIdsFromRaw(null), []);
  assert.deepEqual(extractFiletagIdsFromRaw([1, 2]), []);
  assert.deepEqual(extractFiletagIdsFromRaw("nope"), []);
});

test("mergeFiletagIds deduplicates across lists and trims junk", () => {
  assert.deepEqual(
    mergeFiletagIds(["a", " a ", ""], ["b", null], ["a", "c"]),
    ["a", "b", "c"]
  );
});

test("parseFiletagListPayload digs filetag arrays out of nested envelopes", () => {
  const payload = {
    code: 0,
    data: {
      data_filetag_list: [
        { id: "t-1", name: "Work" },
        { id: "t-2", name: "Personal" },
      ],
    },
  };
  const tags = parseFiletagListPayload(payload);
  assert.equal(tags.length, 2);
  assert.deepEqual(
    tags.map((t) => t.id).sort(),
    ["t-1", "t-2"]
  );
});

test("parseFiletagListPayload walks deep payloads and dedupes by id", () => {
  const payload = {
    data: {
      result: {
        groups: [
          { folders: [{ id: "t-1", name: "Work" }] },
          { folders: [{ id: "t-1", name: "Duplicate" }, { id: "t-2", name: "Misc" }] },
        ],
      },
    },
  };
  const tags = parseFiletagListPayload(payload);
  assert.deepEqual(
    tags.map((t) => t.id).sort(),
    ["t-1", "t-2"]
  );
});

test("mergeFiletagsById keeps the first occurrence per id and ignores junk arrays", () => {
  const tags = mergeFiletagsById([
    [{ id: "t-1", name: "First" }],
    null,
    [{ id: "t-1", name: "Second" }, { id: "t-2", name: "Other" }],
  ]);
  assert.deepEqual(
    tags.map((t) => `${t.id}:${t.name}`).sort(),
    ["t-1:First", "t-2:Other"]
  );
});

test("attachFolderSegmentsToFiles annotates each file using tag metadata", () => {
  const files = [
    { id: "f-1", folderIds: ["t-work"], raw: {} },
    { id: "f-2", folderIds: ["t-inbox"], raw: {} },
    { id: "f-3", folderIds: [], raw: { is_trash: 1 } },
    { id: "f-4", folderIds: ["t-work"], raw: { is_trash: "1" } },
  ];
  const tags = [
    { id: "t-work", name: "Work" },
    { id: "t-inbox", name: "Unfiled", is_unfiled: true },
  ];
  attachFolderSegmentsToFiles(files, tags);
  assert.equal(files[0].folderSegment, "Work");
  assert.equal(files[1].folderSegment, PLAUD_FOLDER_UNFILED);
  assert.equal(files[2].folderSegment, PLAUD_FOLDER_TRASH);
  assert.equal(files[3].folderSegment, PLAUD_FOLDER_TRASH);
});

test("resolveFileFolderSegment sanitizes unsafe characters in folder name", () => {
  const tagById = buildTagByIdMap([{ id: "t", name: "Clients / Acme: Q3" }]);
  const segment = resolveFileFolderSegment({
    folderIds: ["t"],
    raw: {},
    tagById,
    unfiledIds: new Set(),
  });
  assert.doesNotMatch(segment, /[/:]/);
  assert.ok(segment.toLowerCase().includes("clients"));
});

test("collectUnfiledFiletagIds matches localized 'unfiled' folder names", () => {
  const ids = collectUnfiledFiletagIds([
    { id: "ru", name: "Без папки" },
    { id: "en", name: "Untagged" },
    { id: "zh", name: "未分类" },
    { id: "real", name: "Q4 Plans" },
  ]);
  assert.deepEqual(ids.sort(), ["en", "ru", "zh"]);
});
