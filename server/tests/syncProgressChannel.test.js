import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyncProgressChannel,
  PROGRESS_THROTTLE_MS,
} from "../src/telegram/sync/syncProgressChannel.js";

test("throttled channel respects throttle window", () => {
  let now = PROGRESS_THROTTLE_MS;
  const pushes = [];
  const channel = createSyncProgressChannel({
    mode: "throttled",
    delivery: {
      pushProgress: (payload) => {
        pushes.push(payload);
      },
    },
    telegram: {},
    chatId: 1,
    nowMs: () => now,
    getPayload: (stats) => ({ html: `n=${stats.n}`, richMarkdown: "" }),
  });

  channel({ n: 1 });
  channel({ n: 2 });
  assert.equal(pushes.length, 1);

  now += PROGRESS_THROTTLE_MS;
  channel({ n: 3 });
  assert.equal(pushes.length, 2);
  assert.equal(pushes[1].html, "n=3");
});

test("immediate channel opens draft once then pushes", async () => {
  const calls = [];
  const delivery = {
    draftId: 7,
    markRichDraftActive: () => calls.push("rich"),
    markDraftActive: () => calls.push("text"),
    pushProgress: async (payload) => calls.push(`push:${payload.html}`),
  };
  const channel = createSyncProgressChannel({
    mode: "immediate",
    telegram: {
      sendRichMessageDraft: async () => {
        calls.push("api-rich");
      },
    },
    chatId: 1,
    delivery,
    getPayload: (stats) => ({ html: String(stats.step), richMarkdown: "rich" }),
  });

  await channel({ step: 1 });
  await channel({ step: 2 });
  assert.deepEqual(calls, ["api-rich", "rich", "push:2"]);
});
