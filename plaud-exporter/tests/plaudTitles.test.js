import assert from "node:assert/strict";
import test from "node:test";
import {
  TITLE_KEYS,
  PLAUD_TITLE_KEYS,
  normalizeHumanTitle,
  pickRawTitleFromFile,
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
  assert.equal(
    pickRawTitleFromFile({ title: "B", file_name: "A" }),
    "A"
  );
  assert.equal(pickRawTitleFromFile({}), "");
});

test("PLAUD_TITLE_KEYS matches TITLE_KEYS", () => {
  assert.equal(PLAUD_TITLE_KEYS.size, TITLE_KEYS.length);
  for (const key of TITLE_KEYS) {
    assert.ok(PLAUD_TITLE_KEYS.has(key));
  }
});
