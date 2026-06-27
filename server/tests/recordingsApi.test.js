import assert from "node:assert/strict";
import test from "node:test";

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

test("normalizePlaudFile resolves ids from alternate Plaud field names", async () => {
  process.env.PLAUD_MIRROR_FOLDERS = "false";
  const { normalizePlaudFile } = await import("../src/plaud/recordingsApi.js");

  assert.equal(
    normalizePlaudFile({ recording_id: "rec-001", title: "Standup" })?.id,
    "rec-001"
  );
  assert.equal(
    normalizePlaudFile({ audioId: "aud-002", displayName: "Demo" })?.id,
    "aud-002"
  );
  assert.equal(normalizePlaudFile({ title: "No id" }), null);
});

test("normalizeHumanTitle decodes percent-encoded titles", async () => {
  const { normalizeHumanTitle } = await import("../src/plaud/recordingsApi.js");
  assert.equal(
    normalizeHumanTitle("Meeting %D0%9F%D0%BB%D0%B0%D1%83%D0%B4"),
    "Meeting Плауд"
  );
});

test("listAllRecordings throws PlaudChangedError when the first page has no file array", async () => {
  process.env.PLAUD_MIRROR_FOLDERS = "false";
  const { listAllRecordings } = await import("../src/plaud/recordingsApi.js");
  const { PlaudChangedError } = await import("../src/plaud/errors.js");
  const session = makeSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({ status: 0, data: { unexpected: true } });

  try {
    await assert.rejects(
      () => listAllRecordings(session),
      (err) => err instanceof PlaudChangedError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAllRecordings with mirror folders fans out per-folder queries", async () => {
  process.env.PLAUD_MIRROR_FOLDERS = "true";
  process.env.PLAUD_API_MAX_FILES = "100";
  process.env.PLAUD_API_PAGE_LIMIT = "100";
  const { listAllRecordings } = await import("../src/plaud/recordingsApi.js");
  const session = makeSession();

  const requestedUrls = [];
  const folderTaggedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    requestedUrls.push(href);
    if (href.includes("/filetag")) {
      return jsonResponse({
        data: [
          { id: "unf", name: "Unfiled", is_unfiled: true },
          { id: "dev", name: "SocServ Dev" },
          { id: "cap", name: "SocServ Captains" },
        ],
      });
    }
    if (/filetag_id=|file_tag_id=/.test(href)) {
      folderTaggedUrls.push(href);
    }
    return jsonResponse({
      status: 0,
      data: { data_file_list: [] },
    });
  };

  try {
    await listAllRecordings(session, { includeTrash: false });
    const queriedFolderIds = new Set(
      folderTaggedUrls.flatMap((href) => {
        const u = new URL(href);
        return [
          u.searchParams.get("filetag_id"),
          u.searchParams.get("file_tag_id"),
        ].filter(Boolean);
      })
    );
    assert.ok(queriedFolderIds.has("dev"), "expected dev folder fan-out");
    assert.ok(queriedFolderIds.has("cap"), "expected cap folder fan-out");
    assert.ok(queriedFolderIds.has("unf"), "expected unfiled folder fan-out");
    assert.ok(
      requestedUrls.every((href) => {
        const u = new URL(href);
        return u.searchParams.get("is_trash") !== "1";
      }),
      "includeTrash=false should skip explicit trash listing"
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.PLAUD_MIRROR_FOLDERS = "false";
  }
});
