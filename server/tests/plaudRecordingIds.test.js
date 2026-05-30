import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRawRecordingId,
  normalizeHexRecordingId,
  normalizePlaudRecordingId,
} from "../../plaud-exporter/common/plaudRecordingIds.js";

test("extractRawRecordingId reads first present key", () => {
  assert.equal(
    extractRawRecordingId({ recording_id: "rec-001", title: "Standup" }),
    "rec-001"
  );
  assert.equal(extractRawRecordingId({ title: "No id" }), "");
});

test("normalizePlaudRecordingId lowercases 32-hex ids", () => {
  const hex = "a".repeat(32);
  assert.equal(normalizePlaudRecordingId({ file_id: hex.toUpperCase() }), hex);
});

test("normalizePlaudRecordingId keeps non-hex ids for API edge cases", () => {
  assert.equal(normalizePlaudRecordingId({ audioId: "aud-002" }), "aud-002");
});

test("normalizeHexRecordingId matches shared contract", () => {
  assert.equal(normalizeHexRecordingId(""), "");
  assert.equal(normalizeHexRecordingId("short"), "");
});
