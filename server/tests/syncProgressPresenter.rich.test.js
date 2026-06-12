import assert from "node:assert/strict";
import test from "node:test";
import { revealFinal } from "../src/telegram/sync/syncProgressPresenter.js";

test("revealFinal prefers sendRichMessage when richMarkdown is provided", async () => {
  const richCalls = [];
  const sendCalls = [];
  const telegram = {
    sendRichMessage: async (payload) => {
      richCalls.push(payload);
      return { message_id: 99 };
    },
    sendMessage: async (payload) => {
      sendCalls.push(payload);
      return { message_id: 100 };
    },
    sendMessageDraft: async () => true,
    editMessageText: async () => ({ message_id: 1 }),
  };

  const mid = await revealFinal({
    telegram,
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>HTML fallback</b>",
    richMarkdown: "# Rich summary",
    keyboard: null,
    delivery: {
      isDraftMode: () => false,
      finish: async () => 10,
    },
    sleep: async () => {},
  });

  assert.equal(mid, 99);
  assert.equal(richCalls.length, 1);
  assert.equal(richCalls[0].markdown, "# Rich summary");
  assert.equal(sendCalls.length, 0);
});

test("revealFinal falls back to HTML when rich API is unavailable", async () => {
  const telegram = {
    sendRichMessage: async () => {
      throw new Error("sendRichMessage: method not found");
    },
    sendMessage: async () => ({ message_id: 100 }),
    sendMessageDraft: async () => true,
    editMessageText: async () => ({ message_id: 10 }),
  };

  const mid = await revealFinal({
    telegram,
    chatId: 1,
    messageId: 10,
    draftId: 5,
    text: "<b>HTML fallback</b>",
    richMarkdown: "# Rich summary",
    keyboard: null,
    delivery: {
      isDraftMode: () => false,
      finish: async () => 10,
    },
    sleep: async () => {},
  });

  assert.equal(mid, 10);
});
