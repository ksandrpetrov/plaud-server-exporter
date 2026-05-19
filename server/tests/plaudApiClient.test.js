import assert from "node:assert/strict";
import test from "node:test";

process.env.PLAUD_MIRROR_FOLDERS = "false";
import {
  fetchPlaudApi,
  fetchSummaries,
  listAllRecordings,
  normalizePlaudFile,
  PlaudAuthError,
  PlaudChangedError,
  stripPlaudInlineAssets,
} from "../src/plaud/plaudApiClient.js";

function makeSession(overrides = {}) {
  return {
    apiBase: "https://api.plaud.ai",
    authHeader: "Bearer test.token.value",
    userAuthHeader: "Bearer test.token.value",
    workspaceAuthHeader: "",
    workspaceId: "ws-1",
    sortBy: "start_time",
    userId: "u-1",
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("fetchPlaudApi sends Authorization and workspace-id headers", async () => {
  const session = makeSession();
  let captured;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return jsonResponse({ data: [] });
  };
  try {
    await fetchPlaudApi(session, "/file/simple/web?limit=1");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.url, "https://api.plaud.ai/file/simple/web?limit=1");
  assert.equal(captured.init.headers.Authorization, "Bearer test.token.value");
  assert.equal(captured.init.headers["workspace-id"], "ws-1");
  assert.equal(captured.init.headers["edit-from"], "web");
  assert.equal(captured.init.headers["app-platform"], "web");
  assert.equal(captured.init.headers.Origin, "https://web.plaud.ai");
  assert.equal(captured.init.headers.Referer, "https://web.plaud.ai/");
  assert.match(captured.init.headers["User-Agent"], /Chrome/);
});

test("fetchPlaudApi performs -302 region switch once", async () => {
  const session = makeSession();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return jsonResponse({
        status: -302,
        data: { domains: { api: "https://eu.api.plaud.ai" } },
      });
    }
    return jsonResponse({ data: [{ file_id: "f1" }] });
  };
  try {
    const payload = await fetchPlaudApi(session, "/file/simple/web?limit=1");
    assert.equal(calls.length, 2);
    assert.match(calls[1], /eu\.api\.plaud\.ai/);
    assert.equal(payload.data[0].file_id, "f1");
    assert.equal(session.apiBase, "https://eu.api.plaud.ai");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchPlaudApi does not retry on 401 and throws PlaudAuthError", async () => {
  const session = makeSession();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({ message: "no" }, 401);
  };
  try {
    await assert.rejects(
      () => fetchPlaudApi(session, "/file/simple/web?limit=1"),
      (err) => err instanceof PlaudAuthError && err.status === 401
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizePlaudFile picks the first present title field", () => {
  const f = normalizePlaudFile({
    file_id: "abc",
    file_name: "Meeting %D0%9F%D0%BB%D0%B0%D1%83%D0%B4",
  });
  assert.equal(f.id, "abc");
  assert.match(f.title, /Meeting/);
});

test("normalizePlaudFile keeps filetag_id_list on folderIds", () => {
  const f = normalizePlaudFile({
    file_id: "abc",
    file_name: "Weekly",
    filetag_id_list: ["folder-1"],
  });
  assert.deepEqual(f.folderIds, ["folder-1"]);
});

test("normalizePlaudFile accepts EU region id/filename fields", () => {
  const f = normalizePlaudFile({
    id: "5f6f9fa25050feec626c5cd41a052c76",
    filename: "05-18 Meeting notes",
  });
  assert.equal(f.id, "5f6f9fa25050feec626c5cd41a052c76");
  assert.equal(f.title, "05-18 Meeting notes");
});

test("fetchSummaries returns empty array when API reports no notes", async () => {
  const session = makeSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ status: 0, data: [] });
  try {
    const summaries = await fetchSummaries(session, { id: "f1", title: "T", raw: {} });
    assert.deepEqual(summaries, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchSummaries throws PlaudChangedError on unrecognized non-empty payload", async () => {
  const session = makeSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ status: 0, data: { unknown: true } });
  try {
    await assert.rejects(
      () => fetchSummaries(session, { id: "f1", title: "T", raw: {} }),
      (err) => err instanceof PlaudChangedError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stripPlaudInlineAssets removes broken summary_poster image refs", () => {
  const input = [
    "# Meeting",
    "",
    "Some intro paragraph.",
    "",
    "![PLAUD NOTE](permanent/a903bb32899d44cebfb0ad290d1f7964/mem_clCuOCRS93/summary_poster/card_20260515123824-v2@ec0991016d3ae673c11b7a_20260515124016_dfaf005d.png)",
    "",
    "Body continues.",
    "Inline ![card](cdn.plaud.ai/summary_poster/abc.png) reference too.",
    "",
    "![keep me](https://example.com/figure.png)",
  ].join("\n");
  const out = stripPlaudInlineAssets(input);
  assert.doesNotMatch(out, /summary_poster/);
  assert.doesNotMatch(out, /permanent\//);
  assert.doesNotMatch(out, /PLAUD NOTE/);
  assert.match(out, /Body continues\./);
  assert.match(out, /Inline {2}reference too\./);
  assert.match(out, /!\[keep me\]\(https:\/\/example\.com\/figure\.png\)/);
  assert.doesNotMatch(out, /\n{3,}/);
});

test("fetchSummaries strips inline Plaud asset images from note content", async () => {
  const session = makeSession();
  const noisy =
    "# Meeting\n\n" +
    "Body.\n\n" +
    "![PLAUD NOTE](permanent/abc/mem_x/summary_poster/card_1.png)\n\n" +
    "Tail.";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      status: 0,
      data: [
        {
          data_type: "summary",
          data_title: "Summary",
          data_content: noisy,
        },
      ],
    });
  try {
    const summaries = await fetchSummaries(session, {
      id: "f1",
      title: "Meeting",
      raw: {},
    });
    assert.equal(summaries.length, 1);
    assert.doesNotMatch(summaries[0].markdown, /summary_poster/);
    assert.doesNotMatch(summaries[0].markdown, /permanent\//);
    assert.match(summaries[0].markdown, /Body\./);
    assert.match(summaries[0].markdown, /Tail\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAllRecordings reads data_file_list responses", async () => {
  const session = makeSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      status: 0,
      data_file_total: 1,
      data_file_list: [{ id: "eu-1", filename: "Recording" }],
    });
  try {
    const files = await listAllRecordings(session);
    assert.equal(files.length, 1);
    assert.equal(files[0].id, "eu-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAllRecordings paginates and deduplicates", async () => {
  const session = makeSession();
  const originalFetch = globalThis.fetch;
  let page = 0;
  globalThis.fetch = async () => {
    page++;
    if (page === 1) {
      return jsonResponse({
        data: Array.from({ length: 100 }, (_v, i) => ({ file_id: `f${i}` })),
      });
    }
    if (page === 2) {
      return jsonResponse({
        data: [{ file_id: "f99" }, { file_id: "f100" }],
      });
    }
    return jsonResponse({ data: [] });
  };
  try {
    const files = await listAllRecordings(session);
    const ids = new Set(files.map((f) => f.id));
    assert.equal(ids.size, files.length);
    assert.ok(ids.has("f0"));
    assert.ok(ids.has("f100"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
