import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

const { effectiveVaultRoot } = await import("../src/config/config.js");

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("effectiveVaultRoot prefers obsidian vault over export root", () => {
  withEnv(
    {
      PLAUD_OBSIDIAN_VAULT_PATH: "/tmp/plaud-test-vault",
      PLAUD_EXPORT_ROOT: "/tmp/plaud-test-exports",
    },
    () => {
      assert.equal(effectiveVaultRoot(), resolve("/tmp/plaud-test-vault"));
    }
  );
});

test("effectiveVaultRoot falls back to export root when vault unset", () => {
  withEnv(
    {
      PLAUD_OBSIDIAN_VAULT_PATH: undefined,
      PLAUD_EXPORT_ROOT: "/tmp/plaud-test-exports-only",
    },
    () => {
      assert.equal(effectiveVaultRoot(), resolve("/tmp/plaud-test-exports-only"));
    }
  );
});
