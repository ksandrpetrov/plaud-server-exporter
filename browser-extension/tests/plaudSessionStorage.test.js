import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  currentStorageSnapshot,
  readPageStorageSnapshot,
} from "../features/audioExport/plaudSessionStorage.js";
import { getPlaudSession } from "../features/audioExport/plaudBrowserSession.js";

function install(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

function page(t, { throws = false, respond = true } = {}) {
  const listeners = new Set();
  const window = {
    addEventListener(_name, fn) {
      listeners.add(fn);
    },
    removeEventListener(_name, fn) {
      listeners.delete(fn);
    },
    postMessage(data) {
      if (respond)
        for (const fn of [...listeners]) fn({ source: window, data });
    },
    localStorage: {
      length: 1,
      key: () => "pld_tokenstr",
      getItem: () => "page-token",
    },
    sessionStorage: { length: 0 },
  };
  install(t, "window", window);
  install(t, "document", {
    createElement: () => ({ remove() {} }),
    documentElement: {
      appendChild(script) {
        if (throws) throw new Error("CSP denied");
        vm.runInNewContext(script.textContent, { window });
      },
    },
  });
  return { listeners, window };
}

test("page handshake returns storage and removes its listener", async (t) => {
  const { listeners } = page(t);
  const result = await readPageStorageSnapshot();
  assert.equal(result.localStorage.pld_tokenstr, "page-token");
  assert.equal(listeners.size, 0);
});

test("DOM injection failure releases listener immediately", async (t) => {
  const { listeners } = page(t, { throws: true });
  assert.equal(await readPageStorageSnapshot(), null);
  assert.equal(listeners.size, 0);
});

test("handshake ignores foreign messages and times out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { listeners, window } = page(t, { respond: false });
  const promise = readPageStorageSnapshot(10);
  for (const listener of listeners) {
    listener({ source: {}, data: {} });
    listener({ source: window, data: { source: "foreign", id: "wrong" } });
  }
  assert.equal(listeners.size, 1);
  t.mock.timers.tick(10);
  assert.equal(await promise, null);
  assert.equal(listeners.size, 0);
});

test("page token is not cached after logout", async (t) => {
  const { window } = page(t);
  install(t, "localStorage", null);
  install(t, "sessionStorage", null);
  assert.equal((await getPlaudSession()).authHeader, "Bearer page-token");
  window.localStorage.length = 0;
  await assert.rejects(getPlaudSession(), /токен авторизации/);
  assert.deepEqual(currentStorageSnapshot(), {
    localStorage: {},
    sessionStorage: {},
  });
});
