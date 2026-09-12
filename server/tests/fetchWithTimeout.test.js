import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTimeout } from "../src/util/fetchWithTimeout.js";
import {
  fetchPlaudApi,
  fetchUrlTextWithRetries,
} from "../src/plaud/httpTransport.js";
import { listAllOfficialRecordings } from "../src/plaud/officialPlaudApi.js";
import { config } from "../src/config/config.js";

test("completed response clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return new Response("done");
  });
  assert.equal(
    await fetchWithTimeout("https://fixture.test", {}, 10, (r) => r.text()),
    "done"
  );
  t.mock.timers.tick(20);
  assert.equal(signal.aborted, false);
});

for (const [name, operation] of [
  [
    "internal API",
    () =>
      fetchPlaudApi(
        { apiBase: "https://api.plaud.ai", authHeader: "fixture" },
        "/test"
      ),
  ],
  ["summary body", () => fetchUrlTextWithRetries("https://fixture.test")],
  [
    "official API",
    () =>
      listAllOfficialRecordings({
        apiBase: "https://api.plaud.ai",
        authHeader: "fixture",
      }),
  ],
]) {
  test(`${name} aborts a stalled body and exhausts retries`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      calls++;
      const read = () =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("timeout", "AbortError")),
            { once: true }
          )
        );
      return { ok: true, status: 200, json: read, text: read };
    });
    const rejected = assert.rejects(operation(), /timeout/i);
    for (let i = 0; i < config.apiMaxRetries; i++) {
      for (let j = 0; j < 20; j++) await Promise.resolve();
      t.mock.timers.tick(config.apiTimeoutMs);
      for (let j = 0; j < 20; j++) await Promise.resolve();
      t.mock.timers.tick(8000);
    }
    await rejected;
    assert.equal(calls, config.apiMaxRetries);
  });
}
