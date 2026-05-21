import assert from "node:assert/strict";
import test from "node:test";

const { startWebServer, stopWebServer, getWebServerPort } = await import(
  "../src/http/webServer.js"
);

async function withServer(port, fn) {
  process.env.WEBAPP_HOST = "127.0.0.1";
  process.env.WEBAPP_PORT = String(port);
  await stopWebServer().catch(() => {});
  await startWebServer();
  try {
    await fn(getWebServerPort() ?? port);
  } finally {
    await stopWebServer();
  }
}

test("GET /healthz returns status ok", async () => {
  await withServer(18765, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  });
});

test("GET /api/v1/status without init data returns 401", async () => {
  await withServer(18766, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/status`);
    assert.equal(res.status, 401);
  });
});
