import assert from "node:assert/strict";
import test from "node:test";
import {
  getIndexedRecords,
  getRecordByStableId,
} from "../src/sync/syncIndexRead.js";

test("getIndexedRecords flattens records map", () => {
  const rows = getIndexedRecords({
    records: {
      "plaud:abc": { title: "A", status: "success" },
      "plaud:def": { title: "B" },
    },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((r) => r.stableId === "plaud:abc")?.title, "A");
});

test("getRecordByStableId returns record or null", () => {
  const index = {
    records: { "plaud:x": { summaryPath: "/vault/a.md" } },
  };
  assert.equal(
    getRecordByStableId(index, "plaud:x")?.summaryPath,
    "/vault/a.md"
  );
  assert.equal(getRecordByStableId(index, ""), null);
  assert.equal(getRecordByStableId(index, "missing"), null);
});
