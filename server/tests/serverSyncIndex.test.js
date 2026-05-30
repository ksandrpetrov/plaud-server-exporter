import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSyncIndex,
  saveSyncIndex,
  syncIndexInfo,
} from "../src/sync/serverSyncIndex.js";

test("loadSyncIndex returns an empty normalized index for a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-idx-"));
  const path = join(dir, "missing.json");
  const idx = await loadSyncIndex(path);
  assert.equal(idx.v, 1);
  assert.deepEqual(idx.records, {});
  assert.equal(typeof idx.settings, "object");
});

test("saveSyncIndex writes a normalized payload and updates timestamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-idx-"));
  const path = join(dir, "index.json");
  const idx = await loadSyncIndex(path);
  idx.records["plaud:abc"] = {
    stableId: "plaud:abc",
    title: "X",
    summaryHash: "sha256:abc",
  };
  await saveSyncIndex(idx, path);
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.records["plaud:abc"].stableId, "plaud:abc");
  assert.ok(parsed.updatedAt);
});

test("saveSyncIndex keeps a .bak copy of the previous index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-idx-"));
  const path = join(dir, "index.json");
  const idx = await loadSyncIndex(path);
  idx.records["plaud:abc"] = { stableId: "plaud:abc", title: "X" };
  await saveSyncIndex(idx, path);
  idx.records["plaud:def"] = { stableId: "plaud:def", title: "Y" };
  await saveSyncIndex(idx, path);
  const backup = await readFile(`${path}.bak`, "utf8");
  const backupParsed = JSON.parse(backup);
  assert.equal(backupParsed.records["plaud:abc"].title, "X");
  assert.equal(backupParsed.records["plaud:def"], undefined);
  await stat(path);
});

test("syncIndexInfo counts records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plaud-idx-"));
  const path = join(dir, "index.json");
  const idx = await loadSyncIndex(path);
  idx.records["plaud:a"] = { stableId: "plaud:a", title: "A" };
  idx.records["plaud:b"] = { stableId: "plaud:b", title: "B" };
  await saveSyncIndex(idx, path);
  const info = await syncIndexInfo(path);
  assert.equal(info.exists, true);
  assert.equal(info.recordCount, 2);
});
