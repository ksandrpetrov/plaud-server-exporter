import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PlaudAuthError, PlaudChangedError } from "../src/plaud/errors.js";
import { SyncLockError } from "../src/sync/runLock.js";

const dir = await mkdtemp(join(tmpdir(), "plaud-sync-error-ui-"));
process.env.PLAUD_DATA_DIR = join(dir, ".data");
process.env.PLAUD_STATUS_PATH = join(dir, ".data", "status.json");
process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

const {
  sendOrEditLoading,
  editProgressBestEffort,
  revealFinal,
  handleSyncError,
} = await import("../src/telegram/sync/syncProgressPresenter.js");

const baseDelivery = {
  isDraftMode: () => false,
  finish: async () => 10,
};

const noopSleep = async () => {};

test("sendOrEditLoading edits existing message when id is provided", async () => {
  const edits = [];
  const mid = await sendOrEditLoading({
    telegram: {
      editMessageText: async (payload) => {
        edits.push(payload);
        return {};
      },
      sendMessage: async () => assert.fail("should not send"),
    },
    chatId: 1,
    loadingMessageId: 5,
    text: "loading",
  });
  assert.equal(mid, 5);
  assert.equal(edits.length, 1);
});

test("sendOrEditLoading sends fresh message when edit fails", async () => {
  const mid = await sendOrEditLoading({
    telegram: {
      editMessageText: async () => {
        throw new Error("edit failed");
      },
      sendMessage: async () => ({ message_id: 42 }),
    },
    chatId: 1,
    loadingMessageId: 5,
    text: "loading",
  });
  assert.equal(mid, 42);
});

test("sendOrEditLoading sends message when no loading id", async () => {
  const mid = await sendOrEditLoading({
    telegram: {
      sendMessage: async () => ({ message_id: 7 }),
    },
    chatId: 1,
    loadingMessageId: null,
    text: "loading",
  });
  assert.equal(mid, 7);
});

test("sendOrEditLoading returns null when send fails", async () => {
  const mid = await sendOrEditLoading({
    telegram: {
      sendMessage: async () => {
        throw new Error("send failed");
      },
    },
    chatId: 1,
    loadingMessageId: null,
    text: "loading",
  });
  assert.equal(mid, null);
});

test("editProgressBestEffort no-ops without messageId", async () => {
  let called = false;
  await editProgressBestEffort({
    telegram: {
      editMessageText: async () => {
        called = true;
      },
    },
    chatId: 1,
    messageId: null,
    stats: { new: 0 },
  });
  assert.equal(called, false);
});

test("editProgressBestEffort edits progress HTML", async () => {
  const edits = [];
  await editProgressBestEffort({
    telegram: {
      editMessageText: async (payload) => {
        edits.push(payload);
      },
    },
    chatId: 1,
    messageId: 10,
    stats: { processed: 1, total: 5 },
  });
  assert.equal(edits.length, 1);
  assert.match(edits[0].text, /1 из 5/);
});

test("editProgressBestEffort swallows edit errors", async () => {
  await editProgressBestEffort({
    telegram: {
      editMessageText: async () => {
        throw new Error("edit ignored");
      },
    },
    chatId: 1,
    messageId: 10,
    stats: { new: 0 },
  });
});

test("revealFinal falls back when sendRichMessage fails with non-API error", async () => {
  const mid = await revealFinal({
    telegram: {
      sendRichMessage: async () => {
        throw new Error("network timeout");
      },
      sendMessageDraft: async () => true,
      editMessageText: async () => ({}),
    },
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>HTML</b>",
    richMarkdown: "# Rich",
    delivery: baseDelivery,
    sleep: noopSleep,
  });
  assert.equal(mid, 10);
});

test("revealFinal edits in place when editInPlace is true", async () => {
  const edits = [];
  const mid = await revealFinal({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async (payload) => {
        edits.push(payload);
        return {};
      },
    },
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>Done</b>",
    delivery: baseDelivery,
    editInPlace: true,
    sleep: noopSleep,
  });
  assert.equal(mid, 10);
  assert.ok(edits.some((payload) => payload.messageId === 10));
});

test("revealFinal falls back to delivery when editInPlace edit fails", async () => {
  const mid = await revealFinal({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async () => {
        throw new Error("edit failed");
      },
    },
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>Done</b>",
    delivery: baseDelivery,
    editInPlace: true,
    sleep: noopSleep,
  });
  assert.equal(mid, 10);
});

test("revealFinal uses draft finish path when in draft mode", async () => {
  let finished = false;
  const mid = await revealFinal({
    telegram: {
      sendMessageDraft: async () => true,
    },
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>Done</b>",
    delivery: {
      isDraftMode: () => true,
      finish: async () => {
        finished = true;
        return 55;
      },
    },
    sleep: noopSleep,
  });
  assert.equal(mid, 55);
  assert.equal(finished, true);
});

test("revealFinal replaces message when finish returns null", async () => {
  const edits = [];
  const mid = await revealFinal({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async (payload) => {
        edits.push(payload);
        return {};
      },
    },
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>Done</b>",
    delivery: {
      isDraftMode: () => false,
      finish: async () => null,
    },
    sleep: noopSleep,
  });
  assert.equal(mid, 10);
  assert.ok(edits.length >= 1);
});

test("revealFinal sends new message when edit and finish both fail", async () => {
  const sends = [];
  const mid = await revealFinal({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async () => {
        throw new Error("edit failed");
      },
      sendMessage: async (payload) => {
        sends.push(payload);
        return { message_id: 88 };
      },
    },
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>Done</b>",
    delivery: {
      isDraftMode: () => false,
      finish: async () => null,
    },
    sleep: noopSleep,
  });
  assert.equal(mid, 88);
  assert.equal(sends.length, 1);
});

test("revealFinal returns null when final send fails", async () => {
  const mid = await revealFinal({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async () => {
        throw new Error("edit failed");
      },
      sendMessage: async () => {
        throw new Error("send failed");
      },
    },
    chatId: 1,
    messageId: null,
    draftId: 5,
    text: "<b>Done</b>",
    delivery: {
      isDraftMode: () => false,
      finish: async () => null,
    },
    sleep: noopSleep,
  });
  assert.equal(mid, null);
});

test("handleSyncError persists auth failures to status.json", async () => {
  const telegram = {
    editMessageText: async () => ({}),
    sendMessage: async () => ({ message_id: 1 }),
  };
  const result = await handleSyncError({
    telegram,
    chatId: 1,
    messageId: 10,
    draftId: null,
    err: new PlaudAuthError("401 Unauthorized", 401),
    source: "manual",
    durationSec: 1,
    delivery: {
      isDraftMode: () => false,
      finish: async () => 10,
    },
    sleep: async () => {},
  });

  assert.equal(result.status, "auth_rejected");
  const payload = JSON.parse(
    await readFile(process.env.PLAUD_STATUS_PATH, "utf8")
  );
  assert.equal(payload.lastAuthError.message, "401 Unauthorized");
});

test("handleSyncError reveals lock busy message", async () => {
  const result = await handleSyncError({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async () => ({}),
    },
    chatId: 1,
    messageId: 10,
    draftId: null,
    err: new SyncLockError("locked", { pid: 99 }),
    source: "manual",
    durationSec: 1,
    delivery: baseDelivery,
    sleep: noopSleep,
  });
  assert.equal(result.status, "lock_busy");
});

test("handleSyncError reveals plaud_changed summary", async () => {
  const err = new PlaudChangedError("API changed");
  err.stats = { new: 1, updated: 0, unchanged: 0, skipped: 0, errors: 0 };
  const result = await handleSyncError({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async () => ({}),
    },
    chatId: 1,
    messageId: 10,
    draftId: null,
    err,
    source: "manual",
    durationSec: 2,
    delivery: baseDelivery,
    sleep: noopSleep,
  });
  assert.equal(result.status, "failed");
});

test("handleSyncError reveals generic error for unknown failures", async () => {
  const result = await handleSyncError({
    telegram: {
      sendMessageDraft: async () => true,
      editMessageText: async () => ({}),
    },
    chatId: 1,
    messageId: 10,
    draftId: null,
    err: new Error("disk full"),
    source: "manual",
    durationSec: 1,
    delivery: baseDelivery,
    sleep: noopSleep,
  });
  assert.equal(result.status, "failed");
});
