import assert from "node:assert/strict";
import test from "node:test";

function makeOfficialSession() {
  return {
    apiBase: "https://platform.plaud.ai/developer/api",
    authHeader: "Bearer official.token",
    userAuthHeader: "Bearer official.token",
    workspaceAuthHeader: "",
    workspaceId: "",
    sortBy: "start_time",
    userId: "",
    authMode: "oauth",
    apiMode: "official",
  };
}

test("listAllOfficialRecordings paginates official API", async () => {
  process.env.PLAUD_API_PAGE_LIMIT = "10";
  process.env.PLAUD_API_MAX_FILES = "20";
  const { listAllOfficialRecordings } =
    await import("../src/plaud/officialPlaudApi.js");
  const session = makeOfficialSession();
  let page = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    page += 1;
    if (page === 1) {
      return new Response(
        JSON.stringify({
          data: Array.from({ length: 10 }, (_, i) => ({
            id: `file-${i + 1}`,
            name: `Rec ${i + 1}`,
          })),
          page: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ data: [{ id: "file-11", name: "Eleven" }], page: 2 }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const files = await listAllOfficialRecordings(session);
    assert.equal(files.length, 11);
    assert.equal(files[0].title, "Rec 1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchOfficialSummaries extracts inline markdown", async () => {
  const { fetchOfficialSummaries } =
    await import("../src/plaud/officialPlaudApi.js");
  const session = makeOfficialSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "file-1",
        name: "Standup",
        note_list: [
          {
            data_type: "auto_sum_note",
            data_content: "## Summary\n\nHello world",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const summaries = await fetchOfficialSummaries(session, {
      id: "file-1",
      title: "Standup",
    });
    assert.equal(summaries.length, 1);
    assert.match(summaries[0].markdown, /Hello world/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAllRecordings routes to official API when apiMode official", async () => {
  process.env.PLAUD_MIRROR_FOLDERS = "false";
  const { listAllRecordings } = await import("../src/plaud/recordingsApi.js");
  const session = makeOfficialSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /open\/third-party\/files/);
    return new Response(
      JSON.stringify({ data: [{ id: "abc", name: "Test" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const files = await listAllRecordings(session);
    assert.equal(files.length, 1);
    assert.equal(files[0].id, "abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
