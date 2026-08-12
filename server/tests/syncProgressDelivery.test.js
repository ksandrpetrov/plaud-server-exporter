import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyncProgressDelivery,
  deleteStaleProgressMessage,
  dismissDraftBubbleBestEffort,
  tryOpenDraft,
  tryOpenRichDraft,
} from "../src/telegram/streaming/draftChannel.js";

test("createSyncProgressDelivery falls back to the edit tier when the draft API fails", async () => {
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
    "edit tier should update the chat"
  );

  const mid = await delivery.finish({
    text: "<b>Done</b>",
    replyMarkup: null,
    messageEffectId: null,
  });
  assert.equal(mid, 10);
});

/**
 * Все три метода черновиков есть в актуальном Bot API (sendMessageDraft — 9.5,
 * sendRichMessageDraft — 10.1), поэтому легко решить, что edit-ярус мёртвый и
 * его можно удалить. Это не так: `tryOpen*Draft` возвращает false на ЛЮБОЙ
 * ошибке открытия, включая сетевую. Тест фиксирует, что после такого сбоя
 * прогресс всё равно доходит до чата, а итог доставляется.
 */
test("edit tier still delivers when the draft open fails on a transient network error", async () => {
  const edits = [];
  const telegram = {
    sendRichMessageDraft: async () => {
      throw new Error("request to api.telegram.org failed: ETIMEDOUT");
    },
    sendMessageDraft: async () => {
      throw new Error("socket hang up");
    },
    editMessageText: async (payload) => {
      edits.push(payload.text);
      return { message_id: payload.messageId };
    },
    sendMessage: async () => ({ message_id: 77 }),
  };

  const richOpened = await tryOpenRichDraft({
    telegram,
    chatId: 1,
    draftId: 5,
    initialMarkdown: "## Sync",
  });
  const textOpened = await tryOpenDraft({
    telegram,
    chatId: 1,
    draftId: 5,
    initialText: "",
  });
  assert.equal(richOpened, false, "transient error must not count as opened");
  assert.equal(textOpened, false, "transient error must not count as opened");

  const delivery = createSyncProgressDelivery({
    telegram,
    chatId: 1,
    loadingMessageId: 10,
    nowMs: () => 0,
  });

  await delivery.pushProgress("<b>Step 1</b>");
  assert.deepEqual(edits, ["<b>Step 1</b>"], "progress must still reach chat");

  const mid = await delivery.finish({
    text: "<b>Done</b>",
    replyMarkup: null,
    messageEffectId: null,
  });
  assert.equal(mid, 10, "final report must land on the loading bubble");
});

test("createSyncProgressDelivery deletes stale loading bubble after draft finish send", async () => {
  const deletes = [];
  const telegram = {
    sendMessageDraft: async () => true,
    sendMessage: async () => ({ message_id: 42 }),
    deleteMessage: async (payload) => {
      deletes.push(payload);
      return true;
    },
    editMessageText: async () => {
      throw new Error("should not edit in draft finish path");
    },
  };

  const delivery = createSyncProgressDelivery({
    telegram,
    chatId: 1,
    loadingMessageId: 10,
    nowMs: () => 0,
  });
  delivery.markDraftActive();

  const mid = await delivery.finish({
    text: "<b>Done</b>",
    replyMarkup: null,
    messageEffectId: null,
  });
  assert.equal(mid, 42);
  assert.deepEqual(deletes, [{ chatId: 1, messageId: 10 }]);
});

test("tryOpenDraft opens with empty text (thinking) and retries with ⏳ when rejected", async () => {
  const drafts = [];
  const telegram = {
    sendMessageDraft: async ({ text }) => {
      if (text === "") {
        throw new Error("Bad Request: message text is empty");
      }
      drafts.push(text);
      return true;
    },
  };
  const opened = await tryOpenDraft({
    telegram,
    chatId: 1,
    draftId: 5,
    initialText: "",
  });
  assert.equal(opened, true);
  assert.deepEqual(drafts, ["⏳"]);
});

test("deleteStaleProgressMessage is a no-op when ids match or stale id missing", async () => {
  let calls = 0;
  const telegram = {
    deleteMessage: async () => {
      calls++;
      return true;
    },
  };
  await deleteStaleProgressMessage(telegram, 1, 10, 10);
  await deleteStaleProgressMessage(telegram, 1, null, 10);
  assert.equal(calls, 0);
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

test("dismissDraftBubbleBestEffort sends then deletes a throwaway message", async () => {
  const sends = [];
  const deletes = [];
  const telegram = {
    sendMessage: async (payload) => {
      sends.push(payload);
      return { message_id: 99 };
    },
    deleteMessage: async (payload) => {
      deletes.push(payload);
      return true;
    },
  };

  await dismissDraftBubbleBestEffort({ telegram, chatId: 5 });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].text, "\u200b");
  assert.deepEqual(deletes, [{ chatId: 5, messageId: 99 }]);
});
