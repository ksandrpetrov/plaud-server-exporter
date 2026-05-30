import assert from "node:assert/strict";
import test from "node:test";
import { createSyncProgressDelivery } from "../src/telegram/streaming/draftChannel.js";

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
  assert.ok(edits.length >= 1 || sends.length >= 1, "legacy path should update chat");

  const mid = await delivery.finish({
    text: "<b>Done</b>",
    replyMarkup: null,
    messageEffectId: null,
  });
  assert.equal(mid, 10);
});
