import assert from "node:assert/strict";
import test from "node:test";

import { downloadPlaudFile } from "../background/chromeDownloadBridge.js";

function installChromeDownloadMock() {
  const listeners = new Set();
  const calls = { downloads: [], removed: 0 };
  globalThis.chrome = {
    runtime: { lastError: null },
    downloads: {
      download(options, callback) {
        calls.downloads.push(options);
        callback(41);
      },
      search(_query, callback) {
        callback([{ id: 41, state: "in_progress" }]);
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          if (listeners.delete(listener)) calls.removed++;
        },
      },
    },
  };
  return {
    calls,
    emit(delta) {
      for (const listener of [...listeners]) listener(delta);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

test("downloadPlaudFile resolves complete downloads and removes listeners", async () => {
  const mock = installChromeDownloadMock();
  const promise = downloadPlaudFile({
    url: "https://cdn.example.test/audio.mp3",
    filename: "Plaud/Audio/Review.mp3",
    conflictAction: "overwrite",
  });
  await new Promise((resolve) => setImmediate(resolve));
  mock.emit({ id: 41, state: { current: "complete" } });

  const result = await promise;
  assert.equal(result.downloadId, 41);
  assert.equal(result.conflictAction, "overwrite");
  assert.equal(mock.listenerCount(), 0);
  assert.equal(mock.calls.removed, 1);
});

test("downloadPlaudFile rejects interrupted downloads and removes listeners", async () => {
  const mock = installChromeDownloadMock();
  const promise = downloadPlaudFile({
    url: "https://cdn.example.test/audio.mp3",
    filename: "Plaud/Audio/Review.mp3",
  });
  await new Promise((resolve) => setImmediate(resolve));
  mock.emit({
    id: 41,
    state: { current: "interrupted" },
    error: { current: "NETWORK_FAILED" },
  });

  await assert.rejects(promise, /NETWORK_FAILED/);
  assert.equal(mock.listenerCount(), 0);
  assert.equal(mock.calls.removed, 1);
});

test("downloadPlaudFile rejects on timeout and removes listeners", async () => {
  const mock = installChromeDownloadMock();
  await assert.rejects(
    downloadPlaudFile({
      url: "https://cdn.example.test/audio.mp3",
      filename: "Plaud/Audio/Review.mp3",
      timeoutMs: 5,
    }),
    /downloadTimeout|таймаут|timeout|время ожидания/i
  );
  assert.equal(mock.listenerCount(), 0);
  assert.equal(mock.calls.removed, 1);
});

test("downloadPlaudFile turns inline text into a data URL", async () => {
  const mock = installChromeDownloadMock();
  const promise = downloadPlaudFile({
    textContent: "# Summary",
    mimeType: "text/markdown;charset=utf-8",
    filename: "Plaud/Summaries/Summary.md",
  });
  await new Promise((resolve) => setImmediate(resolve));
  mock.emit({ id: 41, state: { current: "complete" } });
  await promise;

  assert.match(mock.calls.downloads[0].url, /^data:text\/markdown/);
  assert.equal(mock.calls.downloads[0].filename, "Plaud/Summaries/Summary.md");
});

test("downloadPlaudFile rejects unsupported or empty requests", async () => {
  installChromeDownloadMock();
  await assert.rejects(
    downloadPlaudFile({ filename: "Plaud/empty" }),
    /bg.noUrl|URL/i
  );

  globalThis.chrome.downloads.download = undefined;
  await assert.rejects(
    downloadPlaudFile({ url: "https://cdn.example.test/audio.mp3" }),
    /bg.downloadsUnsupported|unsupported|недоступен/i
  );
});
