import assert from "node:assert/strict";
import test from "node:test";
import { RICH_THINKING_MARKDOWN } from "../src/telegram/richFormat.js";
import {
  runDraftThinkingPreview,
  tryPushThinkingDraft,
  withThinkingDraft,
} from "../src/telegram/streaming/thinkingDraft.js";

const noSleep = () => Promise.resolve();

function fakeTelegram({ rich = true, emptyTextOk = true, drafts = true } = {}) {
  const calls = [];
  const telegram = { calls };
  if (rich) {
    telegram.sendRichMessageDraft = async (payload) => {
      calls.push({ name: "sendRichMessageDraft", payload });
      return true;
    };
  }
  telegram.sendMessageDraft = async (payload) => {
    if (!drafts) {
      throw new Error("sendMessageDraft: method not found");
    }
    if (payload.text === "" && !emptyTextOk) {
      throw new Error("Bad Request: message text is empty");
    }
    calls.push({ name: "sendMessageDraft", payload });
    return true;
  };
  return telegram;
}

test("tryPushThinkingDraft prefers the rich tg-thinking block", async () => {
  const telegram = fakeTelegram();
  const mode = await tryPushThinkingDraft({ telegram, chatId: 1, draftId: 7 });
  assert.equal(mode, "rich");
  assert.deepEqual(telegram.calls, [
    {
      name: "sendRichMessageDraft",
      payload: { chatId: 1, draftId: 7, markdown: RICH_THINKING_MARKDOWN },
    },
  ]);
});

test("tryPushThinkingDraft falls back to empty text draft without rich API", async () => {
  const telegram = fakeTelegram({ rich: false });
  const mode = await tryPushThinkingDraft({ telegram, chatId: 1, draftId: 7 });
  assert.equal(mode, "text");
  assert.deepEqual(telegram.calls, [
    { name: "sendMessageDraft", payload: { chatId: 1, draftId: 7, text: "" } },
  ]);
});

test("tryPushThinkingDraft uses ⏳ placeholder when empty text is rejected", async () => {
  const telegram = fakeTelegram({ rich: false, emptyTextOk: false });
  const mode = await tryPushThinkingDraft({ telegram, chatId: 1, draftId: 7 });
  assert.equal(mode, "text");
  assert.deepEqual(telegram.calls, [
    {
      name: "sendMessageDraft",
      payload: { chatId: 1, draftId: 7, text: "⏳" },
    },
  ]);
});

test("tryPushThinkingDraft returns false when the draft API is missing", async () => {
  const telegram = fakeTelegram({ rich: false, drafts: false });
  const mode = await tryPushThinkingDraft({ telegram, chatId: 1, draftId: 7 });
  assert.equal(mode, false);
  assert.deepEqual(telegram.calls, []);
});

test("runDraftThinkingPreview pushes thinking then one full-text frame", async () => {
  const telegram = fakeTelegram({ rich: false });
  const text = "<b>Готово.</b> " + "Длинный текст итоговой сводки. ".repeat(4);
  const ok = await runDraftThinkingPreview({
    telegram,
    chatId: 5,
    draftId: 11,
    text,
    sleep: noSleep,
  });
  assert.equal(ok, true);
  const drafts = telegram.calls.filter((c) => c.name === "sendMessageDraft");
  assert.equal(drafts.length, 2, "thinking + full text, no chunk frames");
  assert.equal(drafts[0].payload.text, "");
  assert.equal(drafts[1].payload.text, text);
  assert.equal(drafts[0].payload.draftId, drafts[1].payload.draftId);
});

test("runDraftThinkingPreview pushes the rich frame when markdown is given", async () => {
  const telegram = fakeTelegram();
  const ok = await runDraftThinkingPreview({
    telegram,
    chatId: 5,
    draftId: 11,
    text: "<b>HTML</b> " + "запасной вариант сводки. ".repeat(4),
    richMarkdown: "# Сводка\n\nГотово.",
    sleep: noSleep,
  });
  assert.equal(ok, true);
  const richCalls = telegram.calls.filter(
    (c) => c.name === "sendRichMessageDraft"
  );
  assert.equal(richCalls.length, 2, "rich thinking + rich full frame");
  assert.equal(richCalls[0].payload.markdown, RICH_THINKING_MARKDOWN);
  assert.equal(richCalls[1].payload.markdown, "# Сводка\n\nГотово.");
  assert.equal(
    telegram.calls.filter((c) => c.name === "sendMessageDraft").length,
    0
  );
});

test("runDraftThinkingPreview skips short texts entirely", async () => {
  const telegram = fakeTelegram();
  const ok = await runDraftThinkingPreview({
    telegram,
    chatId: 5,
    text: "ОК",
    sleep: noSleep,
  });
  assert.equal(ok, false);
  assert.deepEqual(telegram.calls, []);
});

test("runDraftThinkingPreview returns false when drafts are unavailable", async () => {
  const telegram = fakeTelegram({ rich: false, drafts: false });
  const ok = await runDraftThinkingPreview({
    telegram,
    chatId: 5,
    text: "Достаточно длинный текст, чтобы пройти порог превью. ".repeat(3),
    sleep: noSleep,
  });
  assert.equal(ok, false);
});

test("withThinkingDraft shows the bubble and returns the callback result", async () => {
  const telegram = fakeTelegram({ rich: false });
  const result = await withThinkingDraft({
    telegram,
    chatId: 9,
    fn: async () => "done",
  });
  assert.equal(result, "done");
  assert.equal(telegram.calls[0].name, "sendMessageDraft");
  assert.equal(telegram.calls[0].payload.text, "");
});

test("withThinkingDraft still runs fn when the draft API is missing", async () => {
  const telegram = fakeTelegram({ rich: false, drafts: false });
  let ran = false;
  const result = await withThinkingDraft({
    telegram,
    chatId: 9,
    fn: async () => {
      ran = true;
      return 42;
    },
  });
  assert.equal(ran, true);
  assert.equal(result, 42);
});
