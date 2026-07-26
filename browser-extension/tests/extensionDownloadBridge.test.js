import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadTextViaBackground,
  downloadViaBackground,
  isSafariUserAgent,
} from "../features/audioExport/extensionDownloadBridge.js";

function installChromiumUserAgent() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent:
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    },
  });
}

function installRuntimeDownloadMock(responses) {
  const messages = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        messages.push(message);
        const response = responses.shift();
        callback(response);
      },
    },
  };
  return messages;
}

test("isSafariUserAgent detects Safari and excludes Chromium derivatives", () => {
  assert.equal(
    isSafariUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    ),
    true
  );
  assert.equal(
    isSafariUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    false
  );
  assert.equal(
    isSafariUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
    ),
    false
  );
  assert.equal(
    isSafariUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0"
    ),
    false
  );
});

test("downloadTextViaBackground sends UTF-8 markdown through the service worker", async () => {
  installChromiumUserAgent();
  const messages = installRuntimeDownloadMock([
    {
      success: true,
      downloadId: 7,
      filename: "Plaud/Summaries/Review.md",
      conflictAction: "overwrite",
    },
  ]);

  const response = await downloadTextViaBackground(
    "# Review",
    "Plaud/Summaries/Review.md",
    { conflictAction: "overwrite" }
  );

  assert.equal(response.downloadId, 7);
  assert.equal(messages[0].action, "downloadPlaudFile");
  assert.equal(messages[0].textContent.startsWith("\uFEFF"), true);
  assert.equal(messages[0].mimeType, "text/markdown;charset=utf-8");
});

test("downloadViaBackground uses direct URL when background accepts it", async () => {
  installChromiumUserAgent();
  const messages = installRuntimeDownloadMock([
    {
      success: true,
      downloadId: 8,
      filename: "Plaud/Audio/Review.mp3",
      conflictAction: "overwrite",
    },
  ]);

  const response = await downloadViaBackground(
    "https://cdn.example.test/review.mp3",
    "Plaud/Audio/Review.mp3",
    { conflictAction: "overwrite" }
  );

  assert.equal(response.downloadId, 8);
  assert.equal(messages[0].url, "https://cdn.example.test/review.mp3");
});

test("downloadViaBackground retries rejected direct URLs through a blob URL", async () => {
  installChromiumUserAgent();
  const messages = installRuntimeDownloadMock([
    { success: false, error: "direct rejected" },
    {
      success: true,
      downloadId: 9,
      filename: "Plaud/Audio/Review.mp3",
      conflictAction: "overwrite",
    },
  ]);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Blob(["audio"]), { status: 200 });
  try {
    const response = await downloadViaBackground(
      "https://cdn.example.test/review.mp3",
      "Plaud/Audio/Review.mp3",
      { conflictAction: "overwrite" }
    );
    assert.equal(response.downloadId, 9);
    assert.equal(messages.length, 2);
    assert.match(messages[1].url, /^blob:/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
