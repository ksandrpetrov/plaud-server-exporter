/**
 * Unit tests for the Чайка-style typewriter wrapper used by
 * `botMessageUtils.safeSend` / `editToMenuScreen` when the dispatcher has
 * `ctx.messageAnimator` wired in.
 *
 * Three behavioural branches:
 *  - short text → single bare API call, no typewriter
 *  - long text via `send` → multiple `sendMessageDraft` frames (Telegram-native
 *    smooth animation in the user's input field) + one final `sendMessage`
 *  - long text via `edit` → draft preview in the input field, then one
 *    `editMessageText` on the menu bubble (no multi-frame in-chat edits)
 *
 * The animator's `safeSend` integration (production wiring in
 * `server/src/telegram/index.js`) is covered separately by
 * `tests/telegramDispatch.test.js`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createMessageAnimator } from "../src/telegram/messageAnimator.js";

function fakeTelegram() {
  const calls = [];
  let nextId = 700;
  return {
    calls,
    sendMessage: async (payload) => {
      const id = nextId++;
      calls.push({ name: "sendMessage", payload, messageId: id });
      return { message_id: id };
    },
    editMessageText: async (payload) => {
      calls.push({ name: "editMessageText", payload });
      return { message_id: payload.messageId };
    },
    sendMessageDraft: async (payload) => {
      calls.push({ name: "sendMessageDraft", payload });
      return true;
    },
    sendChatAction: async () => true,
  };
}

const longText =
  "<b>Plaud экспортер.</b>\n\n" +
  "Готов помочь: смотри меню, выбирай действие, я подсвечу прогресс. " +
  "Эта строка достаточно длинная, чтобы пройти порог typewriter, " +
  "потому что иначе плавная Чайка-style анимация в поле ввода не запустится.";

test("animator.send: short text falls through to a single sendMessage", async () => {
  const telegram = fakeTelegram();
  const animator = createMessageAnimator({
    telegram,
    minLen: 60,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const id = await animator.send({ chatId: 11, text: "ОК" });
  assert.equal(typeof id, "number");
  const names = telegram.calls.map((c) => c.name);
  assert.deepEqual(names, ["sendMessage"]);
  assert.equal(telegram.calls[0].payload.text, "ОК");
});

test("animator.send: long text streams via sendMessageDraft + final sendMessage", async () => {
  const telegram = fakeTelegram();
  const animator = createMessageAnimator({
    telegram,
    minLen: 40,
    maxFrames: 5,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const replyMarkup = {
    inline_keyboard: [[{ text: "ok", callback_data: "x" }]],
  };
  const finalId = await animator.send({
    chatId: 42,
    text: longText,
    replyMarkup,
    messageEffectId: "fxA",
  });
  assert.ok(Number.isInteger(finalId));
  const sends = telegram.calls.filter((c) => c.name === "sendMessage");
  const drafts = telegram.calls.filter((c) => c.name === "sendMessageDraft");
  const edits = telegram.calls.filter((c) => c.name === "editMessageText");
  assert.equal(sends.length, 1, "exactly one sendMessage (final delivery)");
  assert.equal(
    edits.length,
    0,
    "must never edit; jumpy editMessageText path is gone"
  );
  assert.ok(
    drafts.length >= 2,
    `expected several draft frames, got ${drafts.length}`
  );
  const draftIds = new Set(drafts.map((d) => d.payload.draftId));
  assert.equal(
    draftIds.size,
    1,
    "all draft frames share one draft_id for smooth animation"
  );
  const lastDraft = drafts[drafts.length - 1].payload;
  assert.ok(
    lastDraft.text.length < longText.length,
    "draft typewriter ends on a partial prefix (Чайка); full text only in sendMessage"
  );
  assert.equal(
    sends[0].payload.text,
    longText,
    "final sendMessage carries the full text"
  );
  assert.deepEqual(
    sends[0].payload.replyMarkup,
    replyMarkup,
    "final delivery keeps the keyboard"
  );
  assert.equal(
    sends[0].payload.messageEffectId,
    "fxA",
    "final delivery keeps the effect"
  );
});

test("animator.edit: long text drafts then a single editMessageText", async () => {
  const telegram = fakeTelegram();
  const animator = createMessageAnimator({
    telegram,
    minLen: 40,
    maxFrames: 5,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const id = await animator.edit({
    chatId: 5,
    messageId: 999,
    text: longText,
    replyMarkup: { reply: 1 },
    messageEffectId: "fx123",
  });
  assert.equal(id, 999);
  const sends = telegram.calls.filter((c) => c.name === "sendMessage");
  assert.equal(sends.length, 0, "edit must never call sendMessage");
  const drafts = telegram.calls.filter((c) => c.name === "sendMessageDraft");
  assert.ok(
    drafts.length >= 1,
    `edit should preview via sendMessageDraft, got ${drafts.length}`
  );
  const edits = telegram.calls.filter((c) => c.name === "editMessageText");
  assert.equal(edits.length, 1, "edit lands with exactly one editMessageText");
  const payload = edits[0].payload;
  assert.equal(payload.text, longText);
  assert.deepEqual(payload.replyMarkup, { reply: 1 });
  assert.equal(payload.messageEffectId, "fx123");
});

test("animator.edit: short text uses one editMessageText", async () => {
  const telegram = fakeTelegram();
  const animator = createMessageAnimator({
    telegram,
    minLen: 50,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const id = await animator.edit({
    chatId: 5,
    messageId: 999,
    text: "Меню закрыто.",
  });
  assert.equal(id, 999);
  const edits = telegram.calls.filter((c) => c.name === "editMessageText");
  assert.equal(edits.length, 1);
});

test("animator.send: draft errors do not block the final sendMessage", async () => {
  const telegram = fakeTelegram();
  telegram.sendMessageDraft = async () => {
    throw new Error("sendMessageDraft: method not found");
  };
  const animator = createMessageAnimator({
    telegram,
    minLen: 40,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const id = await animator.send({ chatId: 1, text: longText });
  assert.ok(
    Number.isInteger(id),
    "final sendMessage still delivers when draft is unavailable"
  );
  const sends = telegram.calls.filter((c) => c.name === "sendMessage");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].payload.text, longText);
});
