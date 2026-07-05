import assert from "node:assert/strict";
import test from "node:test";
import {
  TITLE_KEYS,
  PLAUD_TITLE_KEYS,
  extractTitleForFileFromPayload,
  isPlausibleRecordingTitle,
  normalizeHumanTitle,
  pickRawTitleFromFile,
  preferApiTitle,
  titleLooksLikeRawId,
} from "../common/plaudTitles.js";

test("normalizeHumanTitle decodes percent-encoded titles", () => {
  assert.equal(
    normalizeHumanTitle("Meeting %D0%9F%D0%BB%D0%B0%D1%83%D0%B4"),
    "Meeting Плауд"
  );
});

test("normalizeHumanTitle trims and collapses whitespace", () => {
  assert.equal(normalizeHumanTitle("  foo   bar  "), "foo bar");
  assert.equal(normalizeHumanTitle(""), "");
});

test("pickRawTitleFromFile uses TITLE_KEYS order", () => {
  assert.equal(pickRawTitleFromFile({ title: "B", file_name: "A" }), "A");
  assert.equal(pickRawTitleFromFile({}), "");
});

test("PLAUD_TITLE_KEYS matches TITLE_KEYS", () => {
  assert.equal(PLAUD_TITLE_KEYS.size, TITLE_KEYS.length);
  for (const key of TITLE_KEYS) {
    assert.ok(PLAUD_TITLE_KEYS.has(key));
  }
});

test("isPlausibleRecordingTitle rejects urls and raw ids", () => {
  assert.equal(isPlausibleRecordingTitle(""), false);
  assert.equal(isPlausibleRecordingTitle("https://x"), false);
  assert.equal(isPlausibleRecordingTitle("a".repeat(401)), false);
  assert.equal(isPlausibleRecordingTitle("Standup with team"), true);
});

test("extractTitleForFileFromPayload finds longest matching title", () => {
  const payload = {
    data: {
      file_id: "abc123",
      file_name: "Short",
      title: "Longer meeting title",
    },
  };
  assert.equal(
    extractTitleForFileFromPayload(payload, "abc123"),
    "Longer meeting title"
  );
});

test("titleLooksLikeRawId detects hex-like titles", () => {
  assert.equal(titleLooksLikeRawId("abc123def456", "abc123def456"), true);
  assert.equal(titleLooksLikeRawId("Weekly sync", "abc123"), false);
});

test("preferApiTitle replaces id-like titles with hint", () => {
  const file = { id: "abc123def456", title: "abc123def456" };
  const updated = preferApiTitle(file, "Team standup");
  assert.equal(updated.title, "Team standup");
});
