import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlaudHeaders,
  decodeJwtSubject,
  describePlaudSessionStorage,
  getPlaudApiBase,
  getPlaudSession,
  getScopedStorageValue,
  normalizeApiBase,
  normalizeBearerToken,
  parseStoredValue,
} from "../features/audioExport/plaudBrowserSession.js";

function makeStorage(values = {}) {
  const store = { ...values };
  return {
    get length() {
      return Object.keys(store).length;
    },
    key(index) {
      return Object.keys(store)[index] ?? null;
    },
    getItem(key) {
      return key in store ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
  };
}

function installStorage(local = {}, session = {}) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: makeStorage(local),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: makeStorage(session),
  });
}

function makeJwt(subject) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=/g, "");
  return `${encode({ alg: "none" })}.${encode({ sub: subject })}.signature`;
}

test("session value and token helpers normalize safely", () => {
  const jwt = makeJwt("user-42");
  assert.deepEqual(parseStoredValue('{"ok":true}'), { ok: true });
  assert.equal(parseStoredValue("plain"), "plain");
  assert.equal(parseStoredValue(null), null);
  assert.equal(normalizeBearerToken(JSON.stringify(jwt)), `Bearer ${jwt}`);
  assert.equal(normalizeBearerToken(`Bearer ${jwt}`), `Bearer ${jwt}`);
  assert.equal(normalizeBearerToken(""), "");
  assert.equal(decodeJwtSubject(jwt), "user-42");
  assert.equal(decodeJwtSubject("not-a-jwt"), "");
});

test("getPlaudSession resolves exact user, workspace and regional API state", async () => {
  const userId = "user-42";
  const jwt = makeJwt(userId);
  installStorage({
    pld_tokenstr: JSON.stringify(jwt),
    [`pld_${userId}:workspaceList`]: JSON.stringify([
      {
        workspaceId: "workspace-7",
        workspaceToken: "workspace-token",
        expiresAt: Date.now() + 60_000,
      },
    ]),
    [`pld_${userId}:currentWorkspaceId`]: JSON.stringify("workspace-7"),
    [`pld_${userId}_workspace-7:sort_by`]: JSON.stringify("end_time"),
    [`pld_${userId}:plaud_user_api_domain`]: JSON.stringify(
      "https://eu.plaud.ai/path"
    ),
  });

  const session = await getPlaudSession();
  assert.equal(session.authHeader, "Bearer workspace-token");
  assert.equal(session.userAuthHeader, `Bearer ${jwt}`);
  assert.equal(session.workspaceId, "workspace-7");
  assert.equal(session.sortBy, "end_time");
  assert.equal(session.apiBase, "https://eu.plaud.ai");
  assert.equal(session.tokenSource, "pld_tokenstr");
  assert.equal(
    getScopedStorageValue(`pld_${userId}_workspace-7:sort_by`),
    "end_time"
  );

  const diagnostics = describePlaudSessionStorage();
  assert.equal(diagnostics.hasKnownUserToken, true);
  assert.equal(diagnostics.currentWorkspaceFound, true);
  assert.equal(diagnostics.hasWorkspaceToken, true);
  assert.equal(JSON.stringify(diagnostics).includes(jwt), false);
});

test("getPlaudSession falls back to user auth for expired workspace tokens", async () => {
  const userId = "user-expired";
  const jwt = makeJwt(userId);
  installStorage({
    tokenstr: jwt,
    [`pld_${userId}:workspaceList`]: JSON.stringify([
      {
        workspaceId: "only-workspace",
        workspaceToken: "expired-token",
        expiresAt: Math.floor((Date.now() - 60_000) / 1000),
      },
    ]),
  });

  const session = await getPlaudSession();
  assert.equal(session.authHeader, `Bearer ${jwt}`);
  assert.equal(session.workspaceAuthHeader, "");
  assert.equal(session.workspaceId, "only-workspace");
  assert.equal(session.sortBy, "start_time");
});

test("getPlaudSession discovers nested JWT and workspace caches", async () => {
  const jwt = makeJwt("nested-user");
  installStorage(
    {
      plaud_auth_cache: JSON.stringify({ session: { accessToken: jwt } }),
      plaud_workspace_cache: JSON.stringify({
        workspaceList: [
          {
            workspaceId: "nested-workspace",
            workspaceToken: "nested-workspace-token",
          },
        ],
      }),
      plaud_currentWorkspaceId: JSON.stringify("nested-workspace"),
      plaud_user_api_domain: JSON.stringify({ domain: "us.plaud.ai" }),
    },
    { unrelated: "value" }
  );

  const session = await getPlaudSession();
  assert.equal(session.authHeader, "Bearer nested-workspace-token");
  assert.equal(session.workspaceId, "nested-workspace");
  assert.equal(session.apiBase, "https://us.plaud.ai");
  assert.match(session.tokenSource, /plaud_auth_cache/);
});

test("getPlaudSession rejects missing authorization without network access", async () => {
  installStorage();
  await assert.rejects(getPlaudSession(), /токен авторизации Plaud/i);
});

test("API base and header helpers reject unsafe domains", () => {
  assert.equal(normalizeApiBase("eu.plaud.ai"), "https://eu.plaud.ai");
  assert.equal(
    normalizeApiBase({ domain: "https://us.plaud.ai/path" }),
    "https://us.plaud.ai"
  );
  assert.equal(
    normalizeApiBase("https://evil.example"),
    "https://api.plaud.ai"
  );
  assert.equal(normalizeApiBase("not a url"), "https://api.plaud.ai");

  installStorage({ plaud_user_api_domain: JSON.stringify("eu.plaud.ai") });
  assert.equal(getPlaudApiBase(), "https://eu.plaud.ai");

  const headers = buildPlaudHeaders(
    {
      apiBase: "https://api.plaud.ai",
      authHeader: "Bearer test",
      userAuthHeader: "Bearer test",
      workspaceAuthHeader: "",
      workspaceId: "workspace",
      sortBy: "start_time",
    },
    { "x-test": "yes" }
  );
  assert.equal(headers.Authorization, "Bearer test");
  assert.equal(headers["workspace-id"], "workspace");
  assert.equal(headers["x-test"], "yes");
});
