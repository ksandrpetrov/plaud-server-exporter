import assert from "node:assert/strict";
import test from "node:test";
import {
  redactError,
  redactString,
  redactValue,
} from "../src/security/redact.js";

test("redactString masks Authorization, Cookie, pld_ keys, JWTs, and hex tokens", () => {
  const sample = [
    "GET /file/simple/web 401 with Authorization: Bearer abc.def.ghi-jkl-mno-pq",
    "Cookie: pld_session=verysecretvalue123; other=ok",
    "pld_tokenstr: eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiJ1MTIzIn0.SflKxwRJSMeKKF2QT4f",
    "raw token aaaabbbbccccdddd1111222233334444aaaabbbbccccdddd1111222233334444",
    "stray bearer Bearer onlyTokenHere.signed.thing",
  ].join("\n");

  const out = redactString(sample);

  assert.match(out, /Authorization: \[REDACTED\]/);
  assert.match(out, /Cookie: \[REDACTED\]/);
  assert.match(out, /pld_tokenstr: \[REDACTED\]/);
  assert.match(out, /\[REDACTED_HEX\]/);
  // The standalone Bearer (not in an Authorization line) is masked.
  assert.match(out, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(out, /Bearer abc\./);
  assert.doesNotMatch(out, /verysecretvalue/);
  assert.doesNotMatch(out, /SflKxwRJSMeKKF2QT4f/);
});

test("redactValue masks sensitive keys recursively", () => {
  const input = {
    headers: {
      Authorization: "Bearer abc.def.ghi",
      Cookie: "pld_session=1",
      OK: "passthrough",
    },
    body: { ok: "yes", token: "should-mask" },
  };
  const out = redactValue(input);
  assert.equal(out.headers.Authorization, "[REDACTED]");
  assert.equal(out.headers.Cookie, "[REDACTED]");
  assert.equal(out.headers.OK, "passthrough");
  assert.equal(out.body.token, "[REDACTED]");
  assert.equal(out.body.ok, "yes");
});

test("redactError produces a clean message and stack", () => {
  const err = new Error(
    "Request failed: Authorization: Bearer eyJhbGciOi.eyJzdWIiOi.signed-thing"
  );
  const safe = redactError(err);
  assert.equal(safe.name, "Error");
  assert.doesNotMatch(safe.message, /Bearer ey/);
  assert.match(safe.message, /\[REDACTED\]/);
});
