import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlausibleRecordingTitle,
  preferApiTitle,
} from "../../browser-extension/common/plaudTitles.js";

test("shared plaudTitles exports resolve from server workspace", () => {
  assert.equal(isPlausibleRecordingTitle("Demo call"), true);
  const file = preferApiTitle(
    { id: "deadbeef", title: "deadbeef" },
    "Sprint planning"
  );
  assert.equal(file.title, "Sprint planning");
});
