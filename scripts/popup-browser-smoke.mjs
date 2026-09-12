/** Offline browser smoke of the real popup markup and script wiring. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../browser-extension/", import.meta.url));
const server = createServer(async (req, res) => {
  const path = resolve(
    root,
    `.${new URL(req.url, "http://localhost").pathname}`
  );
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(path);
    const mime = {
      ".js": "text/javascript",
      ".html": "text/html",
      ".css": "text/css",
    };
    res.setHeader(
      "Content-Type",
      mime[extname(path)] || "application/octet-stream"
    );
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort()
  );
  await page.addInitScript(() => {
    const listeners = new Set();
    const fixture = { running: false, fail: false, online: true };
    window.popupFixture = fixture;
    const tab = () => ({
      id: 7,
      url: fixture.online ? "https://web.plaud.ai/" : "https://example.test/",
    });
    const status = () => ({
      success: true,
      isRunning: fixture.running,
      exportData: fixture.running
        ? {
            status: "running",
            filesTotal: 3,
            filesProcessed: 1,
            audioExported: 1,
            startTime: Date.now(),
          }
        : null,
    });
    window.chrome = {
      scripting: {},
      tabs: {
        query: (_query, cb) => cb([tab()]),
        get: (_id, cb) => cb(tab()),
        sendMessage: (_id, req, cb) =>
          cb(
            req.action === "ping"
              ? { success: true, busy: false }
              : { success: true }
          ),
      },
      storage: {
        local: {
          get: (_keys, cb) => {
            cb?.({});
            return Promise.resolve({});
          },
          set: (_values, cb) => {
            cb?.();
            return Promise.resolve();
          },
        },
        onChanged: { addListener() {} },
      },
      runtime: {
        onMessage: {
          addListener: (fn) => listeners.add(fn),
          removeListener: (fn) => listeners.delete(fn),
        },
        sendMessage: (req, cb) => {
          if (req.action === "startBackgroundExport") {
            fixture.running = !fixture.fail;
            cb({
              success: !fixture.fail,
              error: fixture.fail ? "Fixture failure" : undefined,
            });
          } else if (req.action === "stopExport") {
            fixture.running = false;
            cb({ success: true });
          } else if (req.action === "getExportStatus") cb(status());
          else
            cb({ success: true, isRunning: false, data: { status: "idle" } });
        },
      },
    };
  });
  const url = `http://127.0.0.1:${server.address().port}/popup/popup.html`;
  await page.goto(url);
  await page.waitForFunction(
    () => !document.getElementById("readyPanel").hidden
  );
  await page.locator("#settingsBtn").click();
  await page.locator("#exportBgBtn").click();
  await page.waitForFunction(
    () => !document.getElementById("stopExportBtn").hidden
  );
  await page.waitForFunction(() =>
    document.getElementById("exportStatus").classList.contains("active")
  );
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({
    path: "output/playwright/popup-export.png",
    fullPage: true,
  });
  await page.locator("#stopExportBtn").click();
  await page.waitForFunction(
    () => document.getElementById("stopExportBtn").hidden
  );
  await page.evaluate(() => {
    window.popupFixture.fail = true;
  });
  await page.locator("#exportBgBtn").click();
  await page.waitForFunction(() =>
    document.getElementById("status").classList.contains("status-line--error")
  );
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("readyPanel").hidden
  );
  assert.deepEqual(errors, []);
  console.log(
    "popup-browser-smoke: start, progress, stop, error and reload OK"
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
