import assert from "node:assert/strict";
import test from "node:test";
import {
  clipTelegramText,
  safeSliceHtml,
  TELEGRAM_HTML_MAX_LEN,
} from "../src/telegram/messages/format.js";
import {
  buildTypewriterFrames,
  LoadingPulse,
  typewriterChunks,
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

test("buildTypewriterFrames skips animation below default minLen (60)", () => {
  const frames = buildTypewriterFrames("x".repeat(50));
  assert.deepEqual(frames, ["x".repeat(50)]);
});

test("typewriterChunks matches Чайка: empty below 60 chars, partial prefixes only", () => {
  assert.deepEqual(typewriterChunks("hi"), []);
  assert.deepEqual(typewriterChunks("x".repeat(50)), []);
  const text = "<b>Заголовок</b>\n" + "Длинный текст. ".repeat(30);
  const chunks = typewriterChunks(text);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length < text.length);
    assert.equal((chunk.match(/<b>/g) || []).length, (chunk.match(/<\/b>/g) || []).length);
  }
});

test("clipTelegramText keeps HTML balanced under TELEGRAM_HTML_MAX_LEN", () => {
  const long = "<b>" + "a".repeat(5000) + "</b>";
  const clipped = clipTelegramText(long);
  assert.ok(clipped.length <= TELEGRAM_HTML_MAX_LEN);
  assert.equal((clipped.match(/<b>/g) || []).length, (clipped.match(/<\/b>/g) || []).length);
});

test("buildTypewriterFrames chunks are monotonic and html-safe", () => {
  const text = "<b>Заголовок</b>\n" + "Длинный текст. ".repeat(30);
  const frames = buildTypewriterFrames(text);
  assert.ok(frames.length >= 2);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(
      frames[i].length >= frames[i - 1].length - 8,
      "frames should grow monotonically"
    );
  }
  for (const frame of frames.slice(0, -1)) {
    const opens = (frame.match(/<b>/g) || []).length;
    const closes = (frame.match(/<\/b>/g) || []).length;
    assert.equal(opens, closes);
  }
  assert.equal(frames[frames.length - 1], text);
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
