/**
 * Unit tests for the central GPT-style typewriter wrapper used by
 * `botMessageUtils.safeSend` / `editToMenuScreen` when the dispatcher has
 * `ctx.messageAnimator` wired in.
 *
 * These exercise the three behavioural branches of the animator:
 *  - short text → single bare API call, no typewriter frames
 *  - long text via `send` → exactly one `sendMessage` (placeholder) followed
 *    by several `editMessageText` frames, last frame carries the keyboard
 *  - long text via `edit` → only `editMessageText` calls, last frame carries
 *    the keyboard and the optional `messageEffectId`
 *
 * The animator's `safeSend` integration (production wiring in
 * `server/src/telegram/index.js`) is covered separately by
 * `tests/telegramDispatch.test.js`, which still demands one `sendMessage`
 * per `/menu` even when the animator is active.
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
    sendChatAction: async () => true,
  };
}

const longText =
  "<b>Plaud экспортер.</b>\n\n" +
  "Готов помочь: смотри меню, выбирай действие, я подсвечу прогресс. " +
  "Эта строка достаточно длинная, чтобы пройти порог typewriter.";

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

test("animator.send: long text sends placeholder + animated frames", async () => {
  const telegram = fakeTelegram();
  const animator = createMessageAnimator({
    telegram,
    minLen: 40,
    maxFrames: 5,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const replyMarkup = { inline_keyboard: [[{ text: "ok", callback_data: "x" }]] };
  const finalId = await animator.send({
    chatId: 42,
    text: longText,
    replyMarkup,
  });
  assert.ok(Number.isInteger(finalId));
  const sends = telegram.calls.filter((c) => c.name === "sendMessage");
  const edits = telegram.calls.filter((c) => c.name === "editMessageText");
  assert.equal(sends.length, 1, "exactly one sendMessage (placeholder)");
  assert.ok(edits.length >= 2, `expected several edit frames, got ${edits.length}`);
  const last = edits[edits.length - 1].payload;
  assert.equal(last.text, longText, "final edit carries the full text");
  assert.deepEqual(last.replyMarkup, replyMarkup, "final frame keeps keyboard");
  for (const e of edits.slice(0, -1)) {
    assert.equal(e.payload.replyMarkup, null, "intermediate frames keep no keyboard");
  }
});

test("animator.edit: long text edits the same message through frames", async () => {
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
  const edits = telegram.calls.filter((c) => c.name === "editMessageText");
  assert.ok(edits.length >= 2);
  const last = edits[edits.length - 1].payload;
  assert.equal(last.text, longText);
  assert.deepEqual(last.replyMarkup, { reply: 1 });
  assert.equal(last.messageEffectId, "fx123");
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

test("animator.send: placeholder failure falls back to direct sendMessage", async () => {
  const telegram = fakeTelegram();
  let sendCalls = 0;
  telegram.sendMessage = async (_payload) => {
    sendCalls++;
    if (sendCalls === 1) throw new Error("simulated placeholder failure");
    return { message_id: 1234 };
  };
  const animator = createMessageAnimator({
    telegram,
    minLen: 40,
    sleep: () => Promise.resolve(),
    frameMs: 0,
  });
  const id = await animator.send({ chatId: 1, text: longText });
  assert.equal(id, 1234, "fallback send returns its message_id");
  assert.equal(sendCalls, 2, "fallback retried sendMessage with the full text");
});
