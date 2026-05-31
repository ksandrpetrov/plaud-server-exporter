import assert from "node:assert/strict";
import test from "node:test";
import {
  getRecordingCreatedAtIso,
  getRecordingCreatedAtRaw,
  toIsoFromAny,
} from "../src/plaud/recordingTimestamps.js";

test("getRecordingCreatedAtRaw prefers first non-empty Plaud key", () => {
  assert.equal(
    getRecordingCreatedAtRaw({ created_at: "2026-01-02T10:00:00.000Z" }),
    "2026-01-02T10:00:00.000Z"
  );
  assert.equal(
    getRecordingCreatedAtRaw({ startTime: "1700000000" }),
    "1700000000"
  );
  assert.equal(getRecordingCreatedAtRaw({}), "");
});

test("toIsoFromAny normalizes unix seconds and ISO strings", () => {
  assert.equal(
    toIsoFromAny("2026-01-02T10:00:00.000Z"),
    "2026-01-02T10:00:00.000Z"
  );
  assert.equal(
    toIsoFromAny(1700000000),
    new Date(1700000000 * 1000).toISOString()
  );
});

test("getRecordingCreatedAtIso combines raw lookup and ISO normalization", () => {
  assert.equal(
    getRecordingCreatedAtIso({ createdAt: "2026-01-02T10:00:00.000Z" }),
    "2026-01-02T10:00:00.000Z"
  );
  assert.equal(
    getRecordingCreatedAtIso({ create_time: 1700000000 }),
    new Date(1700000000 * 1000).toISOString()
  );
});
