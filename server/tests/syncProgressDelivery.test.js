import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyncProgressDelivery,
  tryOpenRichDraft,
} from "../src/telegram/streaming/draftChannel.js";

test("createSyncProgressDelivery falls back to legacy when draft API missing", async () => {
  const edits = [];
  const sends = [];
  const telegram = {
    sendMessageDraft: async () => {
      throw new Error("sendMessageDraft: method not found");
    },
    editMessageText: async (payload) => {
      edits.push(payload);
      return { message_id: payload.messageId };
    },
    sendMessage: async (payload) => {
      sends.push(payload);
      return { message_id: 42 };
    },
  };

  const delivery = createSyncProgressDelivery({
    telegram,
    chatId: 1,
    loadingMessageId: 10,
    nowMs: () => 0,
  });

  await delivery.pushProgress("<b>Step 1</b>");
  assert.ok(
    edits.length >= 1 || sends.length >= 1,
    "legacy path should update chat"
  );

  const mid = await delivery.finish({
    text: "<b>Done</b>",
    replyMarkup: null,
    messageEffectId: null,
  });
  assert.equal(mid, 10);
});

test("createSyncProgressDelivery uses rich draft then falls back to text draft", async () => {
  let richCalls = 0;
  let textCalls = 0;
  const telegram = {
    sendRichMessageDraft: async () => {
      richCalls++;
      if (richCalls <= 2) return true;
      throw new Error("sendRichMessageDraft: method not found");
    },
    sendMessageDraft: async () => {
      textCalls++;
      return true;
    },
    editMessageText: async (payload) => ({ message_id: payload.messageId }),
    sendMessage: async () => ({ message_id: 42 }),
  };

  let now = 0;
  const delivery = createSyncProgressDelivery({
    telegram,
    chatId: 1,
    loadingMessageId: 10,
    nowMs: () => (now += 500),
  });

  const opened = await tryOpenRichDraft({
    telegram,
    chatId: 1,
    draftId: delivery.draftId,
    initialMarkdown: "## Sync",
  });
  assert.equal(opened, true);
  delivery.markRichDraftActive();

  await delivery.pushProgress({
    html: "<b>Step 1</b>",
    richMarkdown: "- [x] Step 1",
  });
  assert.equal(richCalls, 2);

  await delivery.pushProgress({
    html: "<b>Step 2</b>",
    richMarkdown: "- [x] Step 2",
  });
  assert.ok(textCalls >= 1, "should fall back to text draft");
});
