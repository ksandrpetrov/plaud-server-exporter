import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("../src/cli/index.js", import.meta.url)
);

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("sync without session snapshot exits with code 2", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-cli-no-session-"));
  const result = await runCli(["sync"], {
    PLAUD_DATA_DIR: join(dir, ".data"),
    PLAUD_SESSION_PATH: join(dir, ".data", "session.json"),
    PLAUD_EXPORT_ROOT: join(dir, "exports"),
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr + result.stdout, /No session snapshot/i);
});

test("sync against a read-only export root surfaces write_error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-cli-readonly-"));
  const dataDir = join(dir, ".data");
  const exportRoot = join(dir, "exports-readonly");

  const { writeFile, mkdir, chmod } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportRoot, { recursive: true });
  await chmod(exportRoot, 0o555);

  await writeFile(
    join(dataDir, "session.json"),
    JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      localStorage: {
        token: "t",
        workspace_token: "w",
        workspace_id: "ws",
        user_id: "u",
      },
      cookies: [],
    }),
    "utf8"
  );

  const result = await runCli(["sync"], {
    PLAUD_DATA_DIR: dataDir,
    PLAUD_SESSION_PATH: join(dataDir, "session.json"),
    PLAUD_EXPORT_ROOT: exportRoot,
    PLAUD_SYNC_INDEX_PATH: join(dataDir, "sync-index.json"),
    PLAUD_STATUS_PATH: join(dataDir, "status.json"),
  });

  await chmod(exportRoot, 0o755);

  assert.notEqual(result.code, 0);
  const errorsDir = join(exportRoot, "_errors");
  const { readdir } = await import("node:fs/promises");
  let names = [];
  try {
    names = await readdir(errorsDir);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const hasErrorReport = names.some((n) => n.endsWith(".md"));
  assert.ok(
    hasErrorReport || /EACCES|EPERM|write|failed/i.test(result.stderr + result.stdout),
    "expected write failure to be visible"
  );
});
