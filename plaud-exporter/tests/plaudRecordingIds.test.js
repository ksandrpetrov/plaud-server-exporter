import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRawRecordingId,
  normalizeHexRecordingId,
  normalizePlaudRecordingId,
  RAW_FILE_ID_RE,
} from "../common/plaudRecordingIds.js";

test("normalizeHexRecordingId accepts 32-hex and dashed uuid", () => {
  const a = "a".repeat(32);
  assert.equal(normalizeHexRecordingId(a), a.toLowerCase());
  const dashed = "ABCDEF01-2345-6789-ABCD-EF0123456789";
  assert.equal(
    normalizeHexRecordingId(dashed),
    "abcdef0123456789abcdef0123456789"
  );
  assert.equal(normalizeHexRecordingId(""), "");
  assert.equal(normalizeHexRecordingId("short"), "");
});

test("RAW_FILE_ID_RE matches 32 hex", () => {
  assert(RAW_FILE_ID_RE.test("abcdef0123456789abcdef0123456789"));
  assert(!RAW_FILE_ID_RE.test("xyz"));
});

test("extractRawRecordingId and normalizePlaudRecordingId align with server", () => {
  assert.equal(
    extractRawRecordingId({ recording_id: "rec-001", title: "Standup" }),
    "rec-001"
  );
  const hex = "abcdef0123456789abcdef0123456789";
  assert.equal(
    normalizePlaudRecordingId({ file_id: hex }),
    hex
  );
});
