import assert from "node:assert/strict";
import test from "node:test";
import {
  _resetKeepAliveChainsForTests,
  dropKeepAliveChain,
  tryStartKeepAliveChain,
} from "../background/exportOrchestrator.js";

test("tryStartKeepAliveChain allows only one chain per tab", () => {
  _resetKeepAliveChainsForTests();
  assert.equal(tryStartKeepAliveChain(7), true);
  assert.equal(tryStartKeepAliveChain(7), false);
  assert.equal(tryStartKeepAliveChain(8), true);
});

test("dropKeepAliveChain clears tab chain state", () => {
  _resetKeepAliveChainsForTests();
  assert.equal(tryStartKeepAliveChain(3), true);
  dropKeepAliveChain(3);
  assert.equal(tryStartKeepAliveChain(3), true);
});
