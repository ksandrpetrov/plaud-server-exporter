import assert from "node:assert/strict";
import test from "node:test";
import { LoadingPulse } from "../src/telegram/streamingDelivery.js";

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
