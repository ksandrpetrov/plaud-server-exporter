import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "../src/util/atomicJson.js";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "plaud-atomic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("new state directory and JSON are private from creation", async (t) => {
  const dir = join(await fixture(t), "state");
  const path = join(dir, "value.json");
  await writeJsonAtomic(path, { ok: true });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ok: true });
});

test("failed rename preserves destination and removes temporary JSON", async (t) => {
  const dir = await fixture(t);
  const destination = join(dir, "existing-directory");
  await mkdir(destination);
  await assert.rejects(
    writeJsonAtomic(destination, { secret: "fixture" }),
    (error) => ["EISDIR", "EPERM", "EACCES"].includes(error.code)
  );
  assert.deepEqual(await readdir(dir), ["existing-directory"]);
  assert.equal((await stat(destination)).isDirectory(), true);
});

test("concurrent atomic writes leave complete JSON and no temporary files", async (t) => {
  const dir = await fixture(t);
  const path = join(dir, "value.json");
  await Promise.all(
    Array.from({ length: 10 }, (_, version) =>
      writeJsonAtomic(path, { version })
    )
  );
  const value = JSON.parse(await readFile(path, "utf8"));
  assert.equal(Number.isInteger(value.version), true);
  assert.deepEqual(await readdir(dir), ["value.json"]);
});
