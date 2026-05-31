import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const dir = await mkdtemp(join(tmpdir(), "plaud-load-session-"));
process.env.PLAUD_DATA_DIR = join(dir, ".data");
process.env.PLAUD_SESSION_PATH = join(dir, ".data", "session.json");
process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

const { loadPlaudSessionFromSnapshotDetailed } =
  await import("../src/auth/loadPlaudSession.js");
const { saveSessionSnapshot } = await import("../src/auth/sessionStore.js");

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

function validSnapshot() {
  const userToken = fakeJwt();
  const workspaceList = [
    {
      workspaceId: "ws-1",
      workspaceToken: "ws.token.value",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  ];
  return {
    version: 1,
    localStorage: {
      pld_tokenstr: userToken,
      [`pld_${FAKE_USER_ID}:currentWorkspaceId`]: '"ws-1"',
      [`pld_${FAKE_USER_ID}:workspaceList`]: JSON.stringify(workspaceList),
      plaud_user_api_domain: '"https://api.plaud.ai"',
    },
  };
}

test("loadPlaudSessionFromSnapshotDetailed returns missing when no snapshot", async () => {
  const result = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "test",
  });
  assert.equal(result.status, "missing");
  assert.equal(result.session, null);
});

test("loadPlaudSessionFromSnapshotDetailed returns ok for valid snapshot", async () => {
  await saveSessionSnapshot(validSnapshot());
  const result = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "test",
  });
  assert.equal(result.status, "ok");
  assert.ok(result.session);
  assert.equal(result.session.userId, FAKE_USER_ID);
});

test("loadPlaudSessionFromSnapshotDetailed returns invalid for unusable snapshot", async () => {
  await saveSessionSnapshot({ version: 1, localStorage: {} });
  const result = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "test",
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.session, null);
  assert.ok(result.error);
});

test("loadPlaudSessionFromSnapshotDetailed treats corrupt snapshot JSON as missing", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, ".data"), { recursive: true });
  await writeFile(process.env.PLAUD_SESSION_PATH, "{not-json", "utf8");
  const result = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "test",
  });
  assert.equal(result.status, "missing");
  assert.equal(result.session, null);
});
