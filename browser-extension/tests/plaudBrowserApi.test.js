import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPlaudApi,
  fetchUrlTextWithRetries,
  fetchWithTimeout,
  fetchPlaudFilesFromApi,
} from "../features/audioExport/plaudBrowserApi.js";
import {
  fetchPlaudAudioUrl,
  fetchPlaudSummaryExports,
  buildSummaryMarkdownForFile,
  extractDownloadUrl,
  tryFetchRecordingTitleHint,
} from "../features/audioExport/plaudMediaFetch.js";

const session = () => ({
  apiBase: "https://api.plaud.ai",
  authHeader: "Bearer fixture",
  workspaceId: "ws",
  sortBy: "start_time",
});
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });

for (const status of [401, 403, 400]) {
  test(`HTTP ${status} fails without retry`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () =>
      json({}, status)
    );
    await assert.rejects(
      fetchPlaudApi(session(), "/test"),
      new RegExp(`HTTP ${status}`)
    );
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test("transient API failure retries and preserves request headers", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.plaud.ai/test");
    assert.equal(init.headers.Authorization, "Bearer fixture");
    assert.equal(init.headers["workspace-id"], "ws");
    return ++calls === 1 ? json({}, 503) : json({ status: 0, data: [1] });
  });
  assert.deepEqual(await fetchPlaudApi(session(), "/test"), {
    status: 0,
    data: [1],
  });
  assert.equal(calls, 2);
});

test("summary download exhausts exactly three transient attempts", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json({}, 429));
  await assert.rejects(
    fetchUrlTextWithRetries("https://example.test/summary"),
    /HTTP 429/
  );
  assert.equal(fetch.mock.callCount(), 3);
});

test("domain switch is bounded and invalid JSON is an explicit failure", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    seen.push(url);
    return json({ status: -302, data: { domains: { api: "eu.plaud.ai" } } });
  });
  await assert.rejects(fetchPlaudApi(session(), "/test"), /-302/);
  assert.deepEqual(seen, [
    "https://api.plaud.ai/test",
    "https://eu.plaud.ai/test",
  ]);
  t.mock.method(globalThis, "fetch", async () => new Response("not json"));
  await assert.rejects(fetchPlaudApi(session(), "/test"), /некорректный JSON/);
});

test("timeout covers response body consumption and releases timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return {
      text: () =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("timeout", "AbortError")),
            { once: true }
          );
        }),
    };
  });
  const pending = fetchWithTimeout("https://example.test", {}, 10, (r) =>
    r.text()
  );
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await Promise.resolve();
  t.mock.timers.tick(10);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("successful response clears timeout without aborting the caller's response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return new Response("ok");
  });
  assert.equal(
    await fetchWithTimeout("https://example.test", {}, 10, (r) => r.text()),
    "ok"
  );
  t.mock.timers.tick(20);
  assert.equal(signal.aborted, false);
});

test("summary export reads inline and linked notes; empty notes are skipped", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    seen.push(String(url));
    if (String(url).includes("query_note"))
      return json({
        data: [
          { data_type: "summary", data_content: "Inline body" },
          { data_type: "summary", data_link: "https://example.test/summary" },
          { data_type: "summary", data_content: "" },
        ],
      });
    return new Response("Linked body");
  });
  const summaries = await fetchPlaudSummaryExports(session(), {
    id: "record",
    title: "Meeting",
  });
  assert.equal(summaries.length, 2);
  assert.match(summaries[0].markdown, /Inline body/);
  assert.match(summaries[1].markdown, /Linked body/);
  assert.equal(seen.length, 2);
});

test("audio URLs, missing URLs and optional title failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    json({ data: { url: "https://example.test/audio.mp3" } })
  );
  assert.equal(
    (await fetchPlaudAudioUrl(session(), "id")).url,
    "https://example.test/audio.mp3"
  );
  t.mock.method(globalThis, "fetch", async () => json({}));
  await assert.rejects(fetchPlaudAudioUrl(session(), "id"), /URL аудио/);
  t.mock.method(globalThis, "fetch", async () => json({}, 403));
  assert.equal(await tryFetchRecordingTitleHint(session(), "id"), "");
  const cycle = { link: "https://example.test/audio.mp3" };
  cycle.self = cycle;
  assert.equal(extractDownloadUrl(cycle), cycle.link);
  assert.equal(
    buildSummaryMarkdownForFile({ title: "Meeting" }, "# Meeting\n\nBody")
      .markdown,
    "# Meeting\n\nBody\n"
  );
});

test("empty API library completes fanout without inventing recordings", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json({ data: [] }));
  assert.deepEqual(await fetchPlaudFilesFromApi(session()), []);
});
