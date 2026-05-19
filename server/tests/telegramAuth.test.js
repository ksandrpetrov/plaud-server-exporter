import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedSender,
  isAllowedUsername,
  isPrivateChat,
  normalizeUserId,
  normalizeUsername,
  userIdFromPayload,
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

test("normalizeUserId accepts only positive integers", () => {
  assert.equal(normalizeUserId(1234), 1234);
  assert.equal(normalizeUserId("5678"), 5678);
  assert.equal(normalizeUserId(0), null);
  assert.equal(normalizeUserId(-1), null);
  assert.equal(normalizeUserId(1.5), null);
  assert.equal(normalizeUserId(""), null);
  assert.equal(normalizeUserId(null), null);
  assert.equal(normalizeUserId(undefined), null);
  assert.equal(normalizeUserId("abc"), null);
});

test("usernameFromPayload / userIdFromPayload read defensively", () => {
  assert.equal(usernameFromPayload({ username: "@Alice" }), "alice");
  assert.equal(usernameFromPayload({}), "");
  assert.equal(usernameFromPayload(null), "");

  assert.equal(userIdFromPayload({ id: 42 }), 42);
  assert.equal(userIdFromPayload({}), null);
  assert.equal(userIdFromPayload(null), null);
});

test("isPrivateChat only allows chat.type === 'private'", () => {
  assert.equal(isPrivateChat({ type: "private" }), true);
  assert.equal(isPrivateChat({ type: "group" }), false);
  assert.equal(isPrivateChat({ type: "supergroup" }), false);
  assert.equal(isPrivateChat({ type: "channel" }), false);
  assert.equal(isPrivateChat({}), false);
  assert.equal(isPrivateChat(null), false);
});

test("isAllowedUsername compares case-insensitively without the leading @", () => {
  assert.equal(isAllowedUsername("Alice", "alice"), true);
  assert.equal(isAllowedUsername("@Alice", "alice"), true);
  assert.equal(isAllowedUsername("alice", "@Alice"), true);
  assert.equal(isAllowedUsername("Bob", "alice"), false);
  assert.equal(isAllowedUsername("", "alice"), false);
  assert.equal(isAllowedUsername("alice", ""), false);
  assert.equal(isAllowedUsername(null, "alice"), false);
});

test("isAllowedSender refuses when neither expected id nor username is set", () => {
  assert.equal(
    isAllowedSender({
      from: { id: 1, username: "alice" },
      allowedUserId: null,
      allowedUsername: "",
    }),
    false
  );
});

test("isAllowedSender matches by user id alone when only id is configured", () => {
  assert.equal(
    isAllowedSender({
      from: { id: 100, username: "anyone" },
      allowedUserId: 100,
      allowedUsername: "",
    }),
    true
  );
  assert.equal(
    isAllowedSender({
      from: { id: 101, username: "anyone" },
      allowedUserId: 100,
      allowedUsername: "",
    }),
    false
  );
});

test("isAllowedSender matches by username alone when only username is configured", () => {
  assert.equal(
    isAllowedSender({
      from: { id: 1, username: "Alice" },
      allowedUserId: null,
      allowedUsername: "alice",
    }),
    true
  );
  assert.equal(
    isAllowedSender({
      from: { id: 1, username: "bob" },
      allowedUserId: null,
      allowedUsername: "alice",
    }),
    false
  );
});

test("isAllowedSender requires both id AND username when both are configured", () => {
  const allowedUserId = 100;
  const allowedUsername = "alice";
  assert.equal(
    isAllowedSender({
      from: { id: 100, username: "Alice" },
      allowedUserId,
      allowedUsername,
    }),
    true
  );
  assert.equal(
    isAllowedSender({
      from: { id: 100, username: "bob" },
      allowedUserId,
      allowedUsername,
    }),
    false,
    "right id, wrong username => reject"
  );
  assert.equal(
    isAllowedSender({
      from: { id: 999, username: "alice" },
      allowedUserId,
      allowedUsername,
    }),
    false,
    "right username (squatted), wrong id => reject"
  );
});

test("isAllowedSender treats missing from / fields as foreign", () => {
  assert.equal(
    isAllowedSender({
      from: null,
      allowedUserId: 100,
      allowedUsername: "alice",
    }),
    false
  );
  assert.equal(
    isAllowedSender({
      from: { id: 100 },
      allowedUserId: 100,
      allowedUsername: "alice",
    }),
    false,
    "id matches but username is missing while username is required => reject"
  );
});
