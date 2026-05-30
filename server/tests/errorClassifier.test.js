import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyError,
  ERROR_KIND_AUTH,
  ERROR_KIND_CONFIG,
  ERROR_KIND_NETWORK,
  ERROR_KIND_PLAUD_CHANGED,
  ERROR_KIND_RATE_LIMIT,
  ERROR_KIND_UNKNOWN,
  ERROR_KIND_WRITE,
} from "../src/errors/errorClassifier.js";
import { PlaudAuthError, PlaudChangedError } from "../src/plaud/errors.js";

test("classifyError maps PlaudAuthError to exit 2", () => {
  const result = classifyError(new PlaudAuthError("Session expired", 401), {
    stage: "auth",
  });
  assert.equal(result.kind, ERROR_KIND_AUTH);
  assert.equal(result.exitCode, 2);
  assert.equal(result.httpStatus, 401);
});

test("classifyError maps PlaudChangedError via instanceof to exit 3", () => {
  const result = classifyError(
    new PlaudChangedError("Unexpected list shape", {
      endpoint: "/file/simple/web",
    }),
    { stage: "list-recordings" }
  );
  assert.equal(result.kind, ERROR_KIND_PLAUD_CHANGED);
  assert.equal(result.exitCode, 3);
  assert.equal(result.needsManualReview, true);
});

test("classifyError maps rate limit and network heuristics", () => {
  assert.equal(
    classifyError(new Error("HTTP 429 Too Many Requests")).kind,
    ERROR_KIND_RATE_LIMIT
  );
  assert.equal(
    classifyError(new Error("fetch failed: ECONNRESET")).kind,
    ERROR_KIND_NETWORK
  );
});

test("classifyError maps write and config failures", () => {
  const writeErr = new Error("EACCES: permission denied");
  writeErr.code = "EACCES";
  assert.equal(classifyError(writeErr).kind, ERROR_KIND_WRITE);

  assert.equal(
    classifyError(new Error("PLAUD_EXPORT_ROOT is missing")).kind,
    ERROR_KIND_CONFIG
  );
});

test("classifyError falls back to unknown_error", () => {
  const result = classifyError(new Error("something odd"));
  assert.equal(result.kind, ERROR_KIND_UNKNOWN);
  assert.equal(result.exitCode, 1);
});
