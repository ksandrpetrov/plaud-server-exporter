import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionFromSnapshot,
  describeSnapshot,
  isLocalStorageSessionReady,
} from "../src/auth/plaudSessionExtractor.js";

const FAKE_USER_ID = "u-abcdef";

function fakeJwt(
  sub = FAKE_USER_ID,
  exp = Math.floor(Date.now() / 1000) + 3600
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, exp })).toString(
    "base64url"
  );
  return `${header}.${payload}.testsignaturepart_aaaaaaaaaa`;
}

test("createSessionFromSnapshot prefers workspace token when not expired", () => {
  const userToken = fakeJwt();
  const workspaceList = [
    {
      workspaceId: "ws-1",
      workspaceToken: "ws.token.value",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  ];
  const snapshot = {
    version: 1,
    localStorage: {
      pld_tokenstr: userToken,
      [`pld_${FAKE_USER_ID}:currentWorkspaceId`]: '"ws-1"',
      [`pld_${FAKE_USER_ID}:workspaceList`]: JSON.stringify(workspaceList),
      plaud_user_api_domain: '"https://api.plaud.ai"',
    },
  };
  const session = createSessionFromSnapshot(snapshot);
  assert.equal(session.userId, FAKE_USER_ID);
  assert.equal(session.workspaceId, "ws-1");
  assert.equal(session.apiBase, "https://api.plaud.ai");
  assert.equal(session.authHeader, "Bearer ws.token.value");
  assert.equal(session.workspaceAuthHeader, "Bearer ws.token.value");
  assert.equal(session.userAuthHeader, `Bearer ${userToken}`);
});

test("createSessionFromSnapshot falls back to user token if workspace is expired", () => {
  const userToken = fakeJwt();
  const workspaceList = [
    {
      workspaceId: "ws-1",
      workspaceToken: "ws.token.value",
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    },
  ];
  const snapshot = {
    version: 1,
    localStorage: {
      pld_tokenstr: userToken,
      [`pld_${FAKE_USER_ID}:currentWorkspaceId`]: '"ws-1"',
      [`pld_${FAKE_USER_ID}:workspaceList`]: JSON.stringify(workspaceList),
    },
  };
  const session = createSessionFromSnapshot(snapshot);
  assert.equal(session.authHeader, `Bearer ${userToken}`);
});

test("createSessionFromSnapshot rejects when no token is present", () => {
  assert.throws(
    () => createSessionFromSnapshot({ version: 1, localStorage: {} }),
    /pld_tokenstr/
  );
});

test("describeSnapshot reports presence without revealing values", () => {
  const userToken = fakeJwt();
  const snapshot = {
    version: 1,
    savedAt: "2026-05-17T10:00:00.000Z",
    localStorage: {
      pld_tokenstr: userToken,
      [`pld_${FAKE_USER_ID}:currentWorkspaceId`]: '"ws-1"',
      [`pld_${FAKE_USER_ID}:workspaceList`]: "[]",
    },
    cookies: [{ name: "x", value: "y" }],
  };
  const desc = describeSnapshot(snapshot);
  assert.equal(desc.present, true);
  assert.equal(desc.hasUserToken, true);
  assert.equal(desc.hasWorkspaceId, true);
  assert.equal(desc.hasWorkspaceList, true);
  assert.equal(desc.cookieCount, 1);
  assert.match(desc.userIdPrefix, /…$/);
  assert.equal(desc.savedAt, "2026-05-17T10:00:00.000Z");
});

test("isLocalStorageSessionReady requires token and workspace keys", () => {
  const userToken = fakeJwt();
  assert.deepEqual(isLocalStorageSessionReady({}), {
    ready: false,
    missing: ["pld_tokenstr"],
  });
  assert.deepEqual(isLocalStorageSessionReady({ pld_tokenstr: userToken }), {
    ready: false,
    missing: [
      `pld_${FAKE_USER_ID}:currentWorkspaceId`,
      `pld_${FAKE_USER_ID}:workspaceList`,
    ],
  });
  assert.deepEqual(
    isLocalStorageSessionReady({
      pld_tokenstr: userToken,
      [`pld_${FAKE_USER_ID}:currentWorkspaceId`]: '"ws-1"',
      [`pld_${FAKE_USER_ID}:workspaceList`]: "[]",
    }),
    { ready: true, missing: [] }
  );
});
