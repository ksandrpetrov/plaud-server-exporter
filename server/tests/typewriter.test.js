import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTypewriterFrames,
  LoadingPulse,
  safeSliceHtml,
  typewriterReveal,
} from "../src/telegram/streamingDelivery.js";

test("safeSliceHtml closes open tags and never cuts inside a tag", () => {
  const text = "<b>Hello <i>world</i> friend</b>";
  const sliced = safeSliceHtml(text, 16);
  assert.ok(sliced.endsWith("</i></b>"), `unexpected slice: ${sliced}`);
  assert.ok(!sliced.match(/<[a-z]*$/), `slice has dangling tag: ${sliced}`);
});

test("safeSliceHtml retreats before an entity if needed", () => {
  const text = "hello&amp;world";
  const sliced = safeSliceHtml(text, 8);
  assert.equal(sliced, "hello");
});

test("buildTypewriterFrames returns single frame for short text", () => {
  const frames = buildTypewriterFrames("short", { minLen: 60 });
  assert.deepEqual(frames, ["short"]);
});

test("buildTypewriterFrames returns growing prefixes ending in full text", () => {
  const body = "<b>Hello</b> ".repeat(20);
  const frames = buildTypewriterFrames(body, { maxFrames: 5, minLen: 30 });
  assert.ok(frames.length >= 2);
  assert.equal(frames[frames.length - 1], body);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(
      frames[i].length >= frames[i - 1].length - 5,
      "frames should grow"
    );
  }
});

test("typewriterReveal edits multiple times with final replyMarkup + effect", async () => {
  const events = [];
  const telegram = {
    editMessageText: async (payload) => {
      events.push(payload);
      return { message_id: payload.messageId };
    },
  };
  const text = "<b>Plaud sync done.</b> ".repeat(8);
  const id = await typewriterReveal({
    telegram,
    chatId: 1,
    messageId: 99,
    text,
    replyMarkup: { foo: 1 },
    messageEffectId: "e123",
    frameMs: 0,
    sleep: () => Promise.resolve(),
    maxFrames: 5,
  });
  assert.equal(id, 99);
  assert.ok(events.length >= 2);
  const last = events[events.length - 1];
  assert.equal(last.text, text);
  assert.deepEqual(last.replyMarkup, { foo: 1 });
  assert.equal(last.messageEffectId, "e123");
});

test("LoadingPulse cycles edit frames and stops cleanly", async () => {
  const events = [];
  const telegram = {
    editMessageText: async (payload) => {
      events.push(payload.text);
      return { message_id: payload.messageId };
    },
  };
  const pulse = new LoadingPulse({
    telegram,
    chatId: 7,
    messageId: 100,
    frames: ["a", "b", "c"],
    frameMs: 5,
  });
  pulse.start();
  await new Promise((r) => setTimeout(r, 30));
  pulse.stop();
  assert.ok(events.length >= 1, `expected pulse ticks, got ${events.length}`);
  const beforeStop = events.length;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events.length, beforeStop);
});
