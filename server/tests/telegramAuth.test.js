import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedUsername,
  normalizeUsername,
  usernameFromPayload,
} from "../src/telegram/auth.js";

test("normalizeUsername strips @ and lowercases", () => {
  assert.equal(normalizeUsername("@Alice"), "alice");
  assert.equal(normalizeUsername("Bob"), "bob");
  assert.equal(normalizeUsername("  carol "), "carol");
  assert.equal(normalizeUsername(""), "");
  assert.equal(normalizeUsername(null), "");
  assert.equal(normalizeUsername(undefined), "");
});

test("isAllowedUsername compares case-insensitively without the leading @", () => {
  assert.equal(isAllowedUsername("Alice", "alice"), true);
  assert.equal(isAllowedUsername("@Alice", "alice"), true);
  assert.equal(isAllowedUsername("alice", "@Alice"), true);
  assert.equal(isAllowedUsername("Bob", "alice"), false);
});

test("isAllowedUsername returns false when either side is empty", () => {
  assert.equal(isAllowedUsername("", "alice"), false);
  assert.equal(isAllowedUsername("alice", ""), false);
  assert.equal(isAllowedUsername(null, "alice"), false);
  assert.equal(isAllowedUsername("alice", null), false);
});

test("usernameFromPayload reads `username` field defensively", () => {
  assert.equal(usernameFromPayload({ username: "@Alice" }), "alice");
  assert.equal(usernameFromPayload({}), "");
  assert.equal(usernameFromPayload(null), "");
  assert.equal(usernameFromPayload(undefined), "");
});
