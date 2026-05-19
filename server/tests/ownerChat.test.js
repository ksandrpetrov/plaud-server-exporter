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

test("saveOwnerChat then loadOwnerChat round-trips chatId, username and userId", async () => {
  const { dir, file } = await tmpFile();
  try {
    const out = await saveOwnerChat(
      { chatId: 12345, username: "Alice", userId: 555 },
      file
    );
    assert.equal(out.status, "saved");
    assert.equal(out.record.chatId, 12345);
    assert.equal(out.record.username, "alice");
    assert.equal(out.record.userId, 555);
    assert.ok(out.record.capturedAt);

    const loaded = await loadOwnerChat(file);
    assert.deepEqual(loaded, out.record);

    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.chatId, 12345);
    assert.equal(raw.username, "alice");
    assert.equal(raw.userId, 555);
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

test("saveOwnerChat refreshes username/userId when chatId matches", async () => {
  const { dir, file } = await tmpFile();
  try {
    await saveOwnerChat({ chatId: 1, username: "first", userId: 100 }, file);
    const second = await saveOwnerChat(
      { chatId: 1, username: "RenamedAccount", userId: 100 },
      file
    );
    assert.equal(second.status, "saved");
    const loaded = await loadOwnerChat(file);
    assert.equal(loaded.chatId, 1);
    assert.equal(loaded.username, "renamedaccount");
    assert.equal(loaded.userId, 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveOwnerChat REJECTS a different chatId (group hijack guard)", async () => {
  const { dir, file } = await tmpFile();
  try {
    await saveOwnerChat({ chatId: 1, username: "owner", userId: 100 }, file);
    const second = await saveOwnerChat(
      { chatId: 999, username: "owner", userId: 100 },
      file
    );
    assert.equal(second.status, "rejected");
    assert.equal(second.existing.chatId, 1);
    const loaded = await loadOwnerChat(file);
    assert.equal(loaded.chatId, 1, "file must still pin the original chatId");
    assert.equal(loaded.username, "owner");
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

test("loadOwnerChat tolerates legacy records without userId", async () => {
  const { dir, file } = await tmpFile();
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      file,
      JSON.stringify({
        chatId: 42,
        username: "legacy",
        capturedAt: "2024-01-01T00:00:00.000Z",
      }),
      "utf8"
    );
    const loaded = await loadOwnerChat(file);
    assert.equal(loaded.chatId, 42);
    assert.equal(loaded.username, "legacy");
    assert.equal(loaded.userId, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
