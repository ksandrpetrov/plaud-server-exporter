import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOwnerChat, saveOwnerChat } from "../src/telegram/ownerChat.js";

async function tmpFile() {
  const dir = await mkdtemp(join(tmpdir(), "plaud-owner-"));
  const file = join(dir, "owner-chat.json");
  return { dir, file };
}

test("saveOwnerChat then loadOwnerChat round-trips chatId and username", async () => {
  const { dir, file } = await tmpFile();
  try {
    const saved = await saveOwnerChat({ chatId: 12345, username: "Alice" }, file);
    assert.equal(saved.chatId, 12345);
    assert.equal(saved.username, "alice");
    assert.ok(saved.capturedAt);

    const loaded = await loadOwnerChat(file);
    assert.deepEqual(loaded, saved);

    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.chatId, 12345);
    assert.equal(raw.username, "alice");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadOwnerChat returns null when the file is missing", async () => {
  const { dir, file } = await tmpFile();
  try {
    const out = await loadOwnerChat(file);
    assert.equal(out, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveOwnerChat overwrites a previous record", async () => {
  const { dir, file } = await tmpFile();
  try {
    await saveOwnerChat({ chatId: 1, username: "first" }, file);
    await saveOwnerChat({ chatId: 2, username: "second" }, file);
    const loaded = await loadOwnerChat(file);
    assert.equal(loaded.chatId, 2);
    assert.equal(loaded.username, "second");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveOwnerChat rejects non-integer chatIds", async () => {
  const { dir, file } = await tmpFile();
  try {
    await assert.rejects(
      () => saveOwnerChat({ chatId: "abc", username: "x" }, file),
      /chatId must be an integer/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
