import assert from "node:assert/strict";
import test from "node:test";
import {
  computeTelegramBackoffMs,
  stringifyTelegramForm,
  waitAfterTelegram429Ms,
} from "../src/telegram/transport/retryPolicy.js";

test("stringifyTelegramForm skips null and stringifies objects", () => {
  assert.deepEqual(
    stringifyTelegramForm({
      chat_id: 1,
      skip: null,
      reply_markup: { inline_keyboard: [] },
    }),
    {
      chat_id: "1",
      reply_markup: '{"inline_keyboard":[]}',
    }
  );
});

test("computeTelegramBackoffMs grows with attempt and stays capped", () => {
  const first = computeTelegramBackoffMs(1, 1000, 5000);
  const second = computeTelegramBackoffMs(2, 1000, 5000);
  assert.ok(first >= 1000 && first <= 1500);
  assert.ok(second >= 2000 && second <= 2500);
  const capped = computeTelegramBackoffMs(10, 1000, 3000);
  assert.ok(capped <= 3500);
});

test("waitAfterTelegram429Ms reads retry_after from JSON body", async () => {
  const response = new Response(
    JSON.stringify({ parameters: { retry_after: 2 } }),
    { status: 429 }
  );
  const waitMs = await waitAfterTelegram429Ms(response, 1500, 30000);
  assert.ok(waitMs >= 2000 && waitMs <= 2500);
});
