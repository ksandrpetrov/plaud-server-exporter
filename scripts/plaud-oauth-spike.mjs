#!/usr/bin/env node
/**
 * Compare Plaud web API (snapshot session) vs official Developer API (OAuth).
 * Read-only; never prints tokens. Exit 0 on success, 1 if nothing to compare.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function countWebSession(sessionPath) {
  const { createSessionFromSnapshot } =
    await import("../server/src/auth/plaudSessionExtractor.js");
  const snapshot = await loadJson(sessionPath);
  if (!snapshot?.localStorage) return null;
  const session = createSessionFromSnapshot(snapshot);
  const url = new URL("/file/simple/web", session.apiBase);
  url.search = new URLSearchParams({
    skip: "0",
    limit: "1",
    sort_by: session.sortBy || "start_time",
    is_desc: "true",
    is_trash: "0",
  }).toString();
  const res = await fetch(url, {
    headers: {
      Authorization: session.authHeader,
      "edit-from": "web",
      "app-platform": "web",
      "Content-Type": "application/json",
      ...(session.workspaceId ? { "workspace-id": session.workspaceId } : {}),
    },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const payload = await res.json();
  const list =
    payload?.data?.data_file_list ??
    payload?.data_file_list ??
    payload?.data?.files ??
    [];
  return { ok: true, sampleCount: Array.isArray(list) ? list.length : 0 };
}

async function countOfficialOAuth(tokenPath) {
  const tokens = await loadJson(tokenPath);
  if (!tokens?.access_token) return null;
  const apiBase =
    process.env.PLAUD_API_BASE || "https://platform.plaud.ai/developer/api";
  const res = await fetch(
    `${apiBase}/open/third-party/files/?page=1&page_size=10`,
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
      },
    }
  );
  if (res.status === 401) return { ok: false, status: 401, hint: "expired" };
  if (!res.ok) return { ok: false, status: res.status };
  const payload = await res.json();
  return {
    ok: true,
    pageItems: Array.isArray(payload?.data) ? payload.data.length : 0,
    page: payload?.page,
  };
}

async function testOAuthOnWebEndpoint(tokenPath, sessionPath) {
  const tokens = await loadJson(tokenPath);
  const { createSessionFromSnapshot } =
    await import("../server/src/auth/plaudSessionExtractor.js");
  const snapshot = await loadJson(sessionPath);
  if (!tokens?.access_token || !snapshot?.localStorage) return null;
  const session = createSessionFromSnapshot(snapshot);
  const url = new URL("/file/simple/web", session.apiBase);
  url.search = new URLSearchParams({ skip: "0", limit: "1" }).toString();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "edit-from": "web",
      "app-platform": "web",
      "Content-Type": "application/json",
      ...(session.workspaceId ? { "workspace-id": session.workspaceId } : {}),
    },
  });
  return { status: res.status, ok: res.ok };
}

async function main() {
  const dataDir =
    process.env.PLAUD_DATA_DIR || join(REPO_ROOT, "server", ".data");
  const sessionPath =
    process.env.PLAUD_SESSION_PATH || join(dataDir, "session.json");
  const oauthPath =
    process.env.PLAUD_OAUTH_TOKENS_PATH || join(dataDir, "oauth-tokens.json");
  const cliTokensPath = join(homedir(), ".plaud", "tokens.json");

  const results = { sessionPath, oauthPath };

  results.webSnapshot = await countWebSession(sessionPath);
  results.oauthOfficial =
    (await countOfficialOAuth(oauthPath)) ||
    (await countOfficialOAuth(cliTokensPath));
  results.oauthOnWebEndpoint = await testOAuthOnWebEndpoint(
    (await loadJson(oauthPath)) ? oauthPath : cliTokensPath,
    sessionPath
  );

  console.log(JSON.stringify(results, null, 2));

  if (!results.webSnapshot && !results.oauthOfficial) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
