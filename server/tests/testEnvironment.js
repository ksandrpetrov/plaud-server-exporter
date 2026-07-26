import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = mkdtempSync(join(tmpdir(), "plaud-server-tests-"));

for (const name of Object.keys(process.env)) {
  if (/^(PLAUD_|TELEGRAM_|BOT_|WEBAPP_)/.test(name)) {
    delete process.env[name];
  }
}

process.env.PLAUD_TEST_ROOT = testRoot;
process.env.PLAUD_ENV_FILE = join(testRoot, "disabled.env");
process.env.PLAUD_DATA_DIR = join(testRoot, ".data");
process.env.PLAUD_EXPORT_ROOT = join(testRoot, "exports");

const nativeFetch = globalThis.fetch;

function isLoopbackUrl(input) {
  const raw =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : String(input);
  const url = new URL(raw);
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  );
}

globalThis.fetch = async (input, init) => {
  if (!isLoopbackUrl(input)) {
    const url = input instanceof Request ? input.url : String(input);
    throw new Error(
      `External fetch is blocked in server tests. Install an explicit mock for: ${url}`
    );
  }
  return nativeFetch(input, init);
};

process.once("exit", () => {
  rmSync(testRoot, { recursive: true, force: true });
});

export { isLoopbackUrl, testRoot };
