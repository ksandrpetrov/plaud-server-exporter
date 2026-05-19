import assert from "node:assert/strict";
import test from "node:test";
import {
  TelegramClient,
  TelegramError,
} from "../src/telegram/telegramClient.js";

function jsonResponse({ status = 200, body, headers = {} } = {}) {
  return {
    status,
    headers: {
      get(name) {
        const lower = name.toLowerCase();
        const entry = Object.entries(headers).find(
          ([k]) => k.toLowerCase() === lower
        );
        return entry ? entry[1] : null;
      },
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body ?? {});
    },
    clone() {
      return jsonResponse({ status, body, headers });
    },
    async json() {
      if (typeof body === "string") return JSON.parse(body);
      return body;
    },
  };
}

function makeClient({ responses, sleepCalls } = {}) {
  const calls = [];
  const responseQueue = [...(responses || [])];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (!responseQueue.length) {
      throw new Error(`Unexpected extra fetch call to ${url}`);
    }
    const next = responseQueue.shift();
    if (typeof next === "function") return next({ url, options });
    return next;
  };
  const sleep = (ms) => {
    sleepCalls?.push(ms);
    return Promise.resolve();
  };
  const client = new TelegramClient("123456:TEST-TOKEN-secret-payload-123", {
    fetchImpl,
    sleep,
    backoffBaseMs: 10,
    backoffCapMs: 50,
  });
  return { client, calls };
}

test("sendMessage returns the result on a 200 response", async () => {
  const { client, calls } = makeClient({
    responses: [
      jsonResponse({
        body: { ok: true, result: { message_id: 42 } },
      }),
    ],
  });

  const result = await client.sendMessage({ chatId: 99, text: "hi" });
  assert.deepEqual(result, { message_id: 42 });
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/
  );
  client.close();
});

test("sendMessage retries on 429 with retry_after, then succeeds", async () => {
  const sleepCalls = [];
  // backoffCapMs must be >= retry_after_ms; we use a 1500ms cap so the
  // 1s retry_after isn't clamped down to the much smaller default cap of
  // the other tests.
  const calls = [];
  const responseQueue = [
    jsonResponse({
      status: 429,
      body: { ok: false, parameters: { retry_after: 1 } },
    }),
    jsonResponse({ body: { ok: true, result: { message_id: 7 } } }),
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return responseQueue.shift();
  };
  const { TelegramClient } = await import("../src/telegram/telegramClient.js");
  const client = new TelegramClient("123456:TEST-TOKEN-secret-payload-123", {
    fetchImpl,
    sleep: (ms) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    },
    backoffBaseMs: 10,
    backoffCapMs: 1500,
  });

  const result = await client.sendMessage({ chatId: 1, text: "x" });
  assert.deepEqual(result, { message_id: 7 });
  assert.equal(calls.length, 2);
  assert.ok(sleepCalls.length >= 1);
  assert.ok(sleepCalls[0] >= 1000, "should wait at least retry_after ms");
  client.close();
});

test("editMessageText surfaces Telegram failure as TelegramError with sanitised text", async () => {
  const { client } = makeClient({
    responses: [
      jsonResponse({
        body: {
          ok: false,
          description: "Bad token: 123456:TEST-TOKEN-secret-payload-123",
        },
      }),
    ],
  });

  await assert.rejects(
    () =>
      client.editMessageText({
        chatId: 1,
        messageId: 2,
        text: "x",
      }),
    (err) => {
      assert.ok(err instanceof TelegramError);
      assert.doesNotMatch(err.message, /TEST-TOKEN-secret-payload-123/);
      assert.match(err.message, /<telegram-token>/);
      return true;
    }
  );
  client.close();
});

test("getUpdates returns the parsed result array", async () => {
  const { client } = makeClient({
    responses: [
      jsonResponse({
        body: { ok: true, result: [{ update_id: 1 }, { update_id: 2 }] },
      }),
    ],
  });

  const updates = await client.getUpdates({ offset: 0, timeoutSec: 1 });
  assert.deepEqual(updates, [{ update_id: 1 }, { update_id: 2 }]);
  client.close();
});

test("network errors are retried up to maxRetries then thrown without leaking the token", async () => {
  const sleepCalls = [];
  const { client, calls } = makeClient({
    sleepCalls,
    responses: [
      () => {
        throw new Error(
          "ECONNRESET while talking to bot 123456:TEST-TOKEN-secret-payload-123"
        );
      },
      () => {
        throw new Error(
          "Another timeout for bot 123456:TEST-TOKEN-secret-payload-123"
        );
      },
    ],
  });

  await assert.rejects(
    () => client.sendMessage({ chatId: 1, text: "x" }),
    (err) => {
      assert.ok(err instanceof TelegramError);
      assert.doesNotMatch(err.message, /TEST-TOKEN-secret-payload-123/);
      return true;
    }
  );
  // sendMessage has SEND_MESSAGE_MAX_RETRIES=1, so 1 initial attempt + 1 retry = 2 calls.
  assert.equal(calls.length, 2);
  client.close();
});
