import assert from "node:assert/strict";
import { test } from "node:test";
import { isAbsolute, relative } from "node:path";

import { config } from "../src/config/config.js";
import { isLoopbackUrl, testRoot } from "./testEnvironment.js";

function isInside(parent, child) {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

test("test preload isolates persistent paths from the working tree", () => {
  assert.equal(process.env.PLAUD_TEST_ROOT, testRoot);
  assert.equal(isInside(testRoot, config.dataDir), true);
  assert.equal(isInside(testRoot, config.exportRoot), true);
  assert.equal(isInside(testRoot, config.sessionPath), true);
  assert.equal(isInside(testRoot, config.oauthTokensPath), true);
  assert.equal(config.telegramBotToken, "");
  assert.equal(config.telegramAllowedUsername, "");
  assert.equal(config.plaudOAuthClientSecret, "");
});

test("test preload blocks external fetch and permits loopback URLs", async () => {
  assert.equal(isLoopbackUrl("http://localhost:8199/callback"), true);
  assert.equal(isLoopbackUrl("http://127.0.0.1:8080/status"), true);
  assert.equal(isLoopbackUrl("http://[::1]:8080/status"), true);
  assert.equal(isLoopbackUrl("https://web.plaud.ai/file/list"), false);

  await assert.rejects(
    fetch("https://web.plaud.ai/file/list"),
    /External fetch is blocked in server tests/
  );
});
