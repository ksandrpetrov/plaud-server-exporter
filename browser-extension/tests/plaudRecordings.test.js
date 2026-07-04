import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaudRecordingFanoutPlan,
  collectPlaudRecordingArrays,
  createPlaudRecordingIngestor,
  extractPlaudRecordingTotal,
  isPlaudRecordingPageDone,
  mergeRawPlaudRecordings,
  normalizePlaudRecording,
  paginatePlaudRecordingVariant,
  runPlaudRecordingFanout,
} from "../common/plaudRecordings.js";

test("normalizePlaudRecording resolves id, title and folder ids", () => {
  const file = normalizePlaudRecording({
    file_id: "ABCDEF0123456789ABCDEF0123456789",
    file_name: "  Weekly   Sync  ",
    filetag_id_list: ["work", "inbox"],
  });
  assert.equal(file.id, "abcdef0123456789abcdef0123456789");
  assert.equal(file.title, "Weekly Sync");
  assert.deepEqual(file.folderIds, ["work", "inbox"]);
  assert.equal(file.folderSegment, "");
  assert.equal(normalizePlaudRecording({ file_name: "No id" }), null);
});

test("collectPlaudRecordingArrays reads direct and nested payload shapes", () => {
  const direct = [{ file_id: "rec-1", file_name: "One" }];
  const nested = [{ id: "rec-2", title: "Two" }];
  const payload = {
    data: {
      data_file_list: direct,
      envelope: { records: nested },
    },
  };
  const arrays = collectPlaudRecordingArrays(payload);
  assert.equal(arrays[0], direct);
  assert.ok(arrays.includes(nested));
});

test("collectPlaudRecordingArrays keeps direct empty arrays as valid shape", () => {
  assert.deepEqual(
    collectPlaudRecordingArrays({ data: { data_file_list: [] } }),
    [[]]
  );
  assert.deepEqual(collectPlaudRecordingArrays({ data: { nope: true } }), []);
});

test("extractPlaudRecordingTotal handles known total field aliases", () => {
  assert.equal(extractPlaudRecordingTotal({ data: { total_count: "12" } }), 12);
  assert.equal(extractPlaudRecordingTotal({ total: 3 }), 3);
  assert.equal(extractPlaudRecordingTotal({ data: { total: -1 } }), null);
});

test("mergeRawPlaudRecordings dedupes by normalized recording id", () => {
  const first = {
    file_id: "ABCDEF0123456789ABCDEF0123456789",
    file_name: "First",
  };
  const duplicate = {
    fileId: "abcdef0123456789abcdef0123456789",
    file_name: "Second",
  };
  const other = { recording_id: "rec-2", file_name: "Other" };
  assert.deepEqual(mergeRawPlaudRecordings([[first, duplicate], [other]]), [
    first,
    other,
  ]);
});

test("isPlaudRecordingPageDone preserves full-page pagination despite total", () => {
  assert.equal(
    isPlaudRecordingPageDone({
      serverTotal: 100,
      rawLen: 100,
      skip: 0,
      pageLimit: 100,
    }),
    false
  );
  assert.equal(
    isPlaudRecordingPageDone({
      serverTotal: 130,
      rawLen: 30,
      skip: 100,
      pageLimit: 100,
    }),
    true
  );
  assert.equal(
    isPlaudRecordingPageDone({
      serverTotal: null,
      rawLen: 10,
      skip: 0,
      pageLimit: 100,
    }),
    true
  );
});

test("createPlaudRecordingIngestor merges folder ids and preserves titles", () => {
  const ingestor = createPlaudRecordingIngestor();
  ingestor.ingest(
    [
      {
        id: "rec-1",
        title: "First title",
        raw: { filetag_id_list: ["a"] },
        folderIds: ["a"],
        folderSegment: "",
      },
    ],
    "ctx"
  );
  ingestor.ingest(
    [
      {
        id: "rec-1",
        title: "Second title",
        raw: { filetag_id_list: ["b"] },
        folderIds: ["b"],
        folderSegment: "",
      },
    ],
    "ctx2"
  );
  const [file] = ingestor.values();
  assert.equal(file.title, "First title");
  assert.deepEqual(file.folderIds.sort(), ["a", "b", "ctx", "ctx2"]);
});

test("paginatePlaudRecordingVariant stops when page is short", async () => {
  let calls = 0;
  const files = await paginatePlaudRecordingVariant({
    pageLimit: 2,
    maxFiles: 10,
    fetchPage: async ({ skip }) => {
      calls++;
      if (Number(skip) === 0) {
        return {
          data: {
            data_file_list: [
              { file_id: "rec-1", file_name: "One" },
              { file_id: "rec-2", file_name: "Two" },
            ],
          },
        };
      }
      return {
        data: { data_file_list: [{ file_id: "rec-3", file_name: "Three" }] },
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(files.length, 3);
});

test("buildPlaudRecordingFanoutPlan covers global, trash, unfiled and folders", () => {
  const plan = buildPlaudRecordingFanoutPlan({
    maxFiles: 123,
    includeTrash: true,
    unfiledIds: ["unf"],
    tags: [
      { id: "unf", name: "Unfiled", is_unfiled: true },
      { id: "dev", name: "Dev" },
      { id: "trash", name: "Trash" },
    ],
  });

  const hasParams = (expected, contextFolderId = "") =>
    plan.some(
      (step) =>
        step.contextFolderId === contextFolderId &&
        Object.entries(expected).every(
          ([key, value]) => step.params[key] === value
        )
    );

  assert.deepEqual(plan[0], {
    params: { is_trash: "0" },
    opts: { maxPages: 1, limitOverride: 123 },
    contextFolderId: "",
  });
  assert.ok(hasParams({ is_trash: "1" }), "expected explicit trash pull");
  assert.ok(
    hasParams({ file_tag_id: "unf" }),
    "expected alternate unfiled parameter"
  );
  assert.ok(
    hasParams({ is_trash: "2", filetag_id: "dev" }, "dev"),
    "expected user folder pull"
  );
  assert.equal(
    hasParams({ is_trash: "2", filetag_id: "trash" }, "trash"),
    false,
    "Trash sidebar tag should not create a folder pull"
  );
});

test("runPlaudRecordingFanout rethrows variant errors without onVariantError", async () => {
  const plan = buildPlaudRecordingFanoutPlan({ maxFiles: 5, tags: [] });
  await assert.rejects(
    () =>
      runPlaudRecordingFanout({
        plan,
        fetchVariant: async () => {
          throw new Error("network down");
        },
      }),
    /network down/
  );
});

test("runPlaudRecordingFanout continues after onVariantError and merges successes", async () => {
  const plan = buildPlaudRecordingFanoutPlan({ maxFiles: 5, tags: [] });
  const errors = [];
  const files = await runPlaudRecordingFanout({
    plan,
    fetchVariant: async (params) => {
      if (params.is_trash === "0") {
        return [
          {
            id: "rec-ok",
            title: "Ok",
            raw: {},
            folderIds: [],
            folderSegment: "",
          },
        ];
      }
      throw new Error("variant failed");
    },
    onVariantError: (err, step) => {
      errors.push({ message: String(err), step: step.params });
    },
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].id, "rec-ok");
  assert.ok(errors.length > 0);
  assert.equal(errors[0].message, "Error: variant failed");
});
