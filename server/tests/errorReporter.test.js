import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaudAuthError } from "../src/plaud/plaudApiClient.js";

const tmpRoot = await mkdtemp(join(tmpdir(), "plaud-errors-"));
process.env.PLAUD_EXPORT_ROOT = join(tmpRoot, "exports");
process.env.PLAUD_TIMEZONE = "UTC";

const { reportError } = await import("../src/errors/errorReporter.js");
const {
  classifyError,
  ERROR_KIND_AUTH,
  ERROR_KIND_PLAUD_CHANGED,
  ERROR_KIND_NETWORK,
  ERROR_KIND_RATE_LIMIT,
  ERROR_KIND_WRITE,
  ERROR_KIND_CONFIG,
  ERROR_KIND_UNKNOWN,
} = await import("../src/errors/errorClassifier.js");

test("classifyError maps auth and plaud_changed", () => {
  const auth = classifyError(new PlaudAuthError("expired", 401), { stage: "auth" });
  assert.equal(auth.kind, ERROR_KIND_AUTH);
  assert.equal(auth.exitCode, 2);

  const changed = classifyError(new Error("unexpected response shape"), {
    stage: "fetch-summary",
  });
  assert.equal(changed.kind, ERROR_KIND_PLAUD_CHANGED);
  assert.equal(changed.needsManualReview, true);
  assert.equal(changed.exitCode, 3);
});

test("classifyError maps network, rate-limit, write, config, and unknown", () => {
  const net = classifyError(new Error("fetch failed: ECONNRESET"));
  assert.equal(net.kind, ERROR_KIND_NETWORK);
  assert.equal(net.exitCode, 1);

  const rate = classifyError(new Error("HTTP 429 rate-limited"));
  assert.equal(rate.kind, ERROR_KIND_RATE_LIMIT);

  const writeErr = Object.assign(new Error("EACCES: permission denied"), {
    code: "EACCES",
  });
  const w = classifyError(writeErr);
  assert.equal(w.kind, ERROR_KIND_WRITE);

  const cfg = classifyError(new Error("invalid path PLAUD_EXPORT_ROOT not found"));
  assert.equal(cfg.kind, ERROR_KIND_CONFIG);
  assert.equal(cfg.exitCode, 2);

  const unk = classifyError(new Error("something off"));
  assert.equal(unk.kind, ERROR_KIND_UNKNOWN);
  assert.equal(unk.exitCode, 1);
});

test("reportError writes markdown under _errors without secrets", async () => {
  const token = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.sig";
  const err = new PlaudAuthError(`Session failed ${token}`, 401);
  const first = await reportError(err, { stage: "auth", runId: "run-test-1" });
  assert.ok(first.path.includes("_errors"));
  const body = await readFile(first.path, "utf8");
  assert.match(body, /# Plaud export error/);
  assert.match(body, /Kind: auth_error/);
  assert.doesNotMatch(body, /eyJhbGci/);
  assert.doesNotMatch(body, /Bearer eyJ/);

  const second = await reportError(err, { stage: "auth", runId: "run-test-2" });
  assert.equal(second.skipped, true);
  const files = await readdir(join(tmpRoot, "exports", "_errors"));
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  assert.ok(mdFiles.length >= 1);
  assert.ok(mdFiles.some((f) => f.includes("plaud-export-error-")));
});

test("dry-run does not create error files", async () => {
  const result = await reportError(new Error("fail"), {
    stage: "write-file",
    dryRun: true,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.path, "");
});
