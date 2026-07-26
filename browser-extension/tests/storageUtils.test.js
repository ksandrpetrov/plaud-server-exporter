import assert from "node:assert/strict";
import test from "node:test";
import {
  storageGet,
  storageRemove,
  storageSet,
} from "../common/storageUtils.js";

function installChromeStorageMock() {
  const values = {};
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in values)
                .map((key) => [key, values[key]])
            )
          );
        },
        set(patch, callback) {
          Object.assign(values, patch);
          callback();
        },
        remove(keys, callback) {
          for (const key of keys) delete values[key];
          callback();
        },
      },
    },
  };
}

test("storage helpers resolve after setting and removing values", async () => {
  installChromeStorageMock();

  await storageSet({ example: 42 });
  assert.deepEqual(await storageGet(["example"]), { example: 42 });

  await storageRemove(["example"]);
  assert.deepEqual(await storageGet(["example"]), {});
});
