import assert from "node:assert/strict";
import test from "node:test";
import { isSafariUserAgent } from "../features/audioExport/extensionDownloadBridge.js";

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
