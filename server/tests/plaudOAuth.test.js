import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const dir = await mkdtemp(join(tmpdir(), "plaud-oauth-"));
process.env.PLAUD_DATA_DIR = join(dir, ".data");
process.env.PLAUD_OAUTH_TOKENS_PATH = join(dir, ".data", "oauth-tokens.json");
process.env.PLAUD_SESSION_PATH = join(dir, ".data", "session.json");
process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");
process.env.PLAUD_AUTH_MODE = "oauth";
process.env.PLAUD_API_MODE = "official";

const { saveOAuthTokens } = await import("../src/auth/oauthTokenStore.js");
const { getOAuthAccessToken, createSessionFromOAuth, refreshOAuthTokens } =
  await import("../src/auth/plaudOAuth.js");

test("getOAuthAccessToken returns token when not expired", async () => {
  await saveOAuthTokens({
    access_token: "access.test.token",
    refresh_token: "refresh.test.token",
    expires_at: Date.now() + 3600_000,
  });
  const token = await getOAuthAccessToken();
  assert.equal(token, "access.test.token");
});

test("getOAuthAccessToken refreshes when near expiry", async () => {
  await saveOAuthTokens({
    access_token: "old.access",
    refresh_token: "refresh.test.token",
    expires_at: Date.now() + 30_000,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /access-token\/refresh/);
    assert.match(String(init?.body), /refresh.test.token/);
    return new Response(
      JSON.stringify({
        access_token: "new.access",
        refresh_token: "refresh.test.token",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const token = await getOAuthAccessToken();
    assert.equal(token, "new.access");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createSessionFromOAuth builds official API session", async () => {
  await saveOAuthTokens({
    access_token: "access.test.token",
    expires_at: Date.now() + 3600_000,
  });
  const session = await createSessionFromOAuth();
  assert.ok(session);
  assert.equal(session.authMode, "oauth");
  assert.equal(session.apiMode, "official");
  assert.match(session.authHeader, /^Bearer /);
  assert.match(session.apiBase, /platform\.plaud\.ai/);
});

test("refreshOAuthTokens persists new token set", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "rotated.access",
        refresh_token: "rotated.refresh",
        expires_in: 7200,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const tokenSet = await refreshOAuthTokens("old.refresh");
    assert.equal(tokenSet.access_token, "rotated.access");
    const loaded = await getOAuthAccessToken();
    assert.equal(loaded, "rotated.access");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
