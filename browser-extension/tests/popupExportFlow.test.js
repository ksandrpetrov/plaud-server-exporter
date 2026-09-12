import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function setup() {
  let nextId = 0;
  const intervals = new Map();
  const timers = new Map();
  const events = new Map();
  const messages = [];
  const listeners = new Set();
  const sandbox = {
    console,
    setTimeout(fn) {
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn) {
      const id = ++nextId;
      intervals.set(id, fn);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    addEventListener(name, fn) {
      const fns = events.get(name) || [];
      fns.push(fn);
      events.set(name, fns);
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            listeners.add(fn);
          },
          removeListener(fn) {
            listeners.delete(fn);
          },
        },
      },
    },
    PlaudPopup: {},
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const name of [
    "exportStatusPolling",
    "exportStatusFormat",
    "exportControls",
    "exportForegroundFlow",
    "exportView",
    "exportPolling",
    "exportActions",
    "popupExportUi",
  ]) {
    const path = fileURLToPath(new URL(`../popup/${name}.js`, import.meta.url));
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  }
  const PP = sandbox.PlaudPopup;
  const status = { textContent: "", className: "" };
  const nodes = new Map();
  const container = {
    innerHTML: "",
    dataset: {},
    classList: { add() {}, remove() {} },
    querySelector(selector) {
      if (!nodes.has(selector))
        nodes.set(selector, { textContent: "", style: {} });
      return nodes.get(selector);
    },
  };
  const buttons = {};
  for (const name of ["exportBgBtn", "stopExportBtn", "downloadBtn"]) {
    buttons[name] = {
      addEventListener(_name, fn) {
        this.click = fn;
      },
      setAttribute() {},
    };
  }
  const ctx = {
    els: { ...buttons, statusEl: status, exportStatusContainer: container },
    getExportModeLabel: () => "summary",
    tr: (key) => key,
    contentErrorMessage: () => "error",
    getPlaudTabHelpText: () => "open Plaud",
    hasChromeExtensionApi: true,
    activeTabIsPlaud: true,
    EXPORT_MODE_SUMMARY: "summary",
    selectedAdvancedExportMode: "summary",
    exportActionButtons: [],
    exportActive: false,
    getFocusedTab(fn) {
      fn(null, { id: 7, url: "https://web.plaud.ai" });
    },
    ensureActiveTabHasUrl(tab, fn) {
      fn(tab);
    },
    isPlaudTab: () => true,
    sendRuntimeMessage(request, cb) {
      messages.push({ request, cb });
    },
    sendMessageToTabWithRecovery(tab, request, cb) {
      messages.push({ request, cb, tab });
    },
    runAfterNextPaint(fn) {
      fn();
    },
    setPlaudTabState() {},
    refreshSmartSyncStatus() {},
    pingContentBusyState() {},
    applyContentBusyFromPing() {},
    updateTabBadgeOpenPlaudAction() {},
    setRecordingPreview() {},
  };
  PP.initExport(ctx);
  ctx.bindExportUi();
  return {
    ctx,
    messages,
    intervals,
    timers,
    listeners,
    status,
    buttons,
    nodes,
    tick() {
      for (const fn of [...intervals.values()]) fn();
    },
    close() {
      for (const fn of events.get("pagehide") || []) fn();
    },
  };
}

test("background export starts, reports progress, stops and ignores a late poll", () => {
  const f = setup();
  f.buttons.exportBgBtn.click();
  assert.equal(f.messages[0].request.action, "startBackgroundExport");
  f.messages.shift().cb(null, { success: true });
  assert.equal(f.ctx.exportActive, true);
  f.tick();
  const first = f.messages.shift();
  first.cb(null, {
    success: true,
    isRunning: true,
    exportData: { status: "running" },
  });
  assert.equal(f.ctx.exportActive, true);
  f.tick();
  const late = f.messages.shift();
  f.buttons.stopExportBtn.click();
  f.messages.shift().cb(null, { success: true });
  late.cb(null, { success: true, isRunning: true });
  assert.equal(f.ctx.exportActive, false);
  assert.equal(f.intervals.size, 0);
  f.close();
  assert.equal(f.timers.size, 0);
});

test("poll timeout is bounded and overlapping requests are suppressed", () => {
  const f = setup();
  f.ctx.exportActive = true;
  f.ctx.startStatusPolling();
  for (let i = 0; i < 4; i++) {
    f.tick();
    f.tick();
    assert.equal(f.messages.length, i + 1);
    for (const fn of [...f.timers.values()]) fn();
  }
  assert.equal(f.ctx.exportActive, false);
  assert.equal(f.intervals.size, 0);
});

test("reopening popup restores running export and completion releases polling", () => {
  const f = setup();
  f.ctx.checkExportStatus();
  f.messages.shift().cb(null, {
    success: true,
    isRunning: true,
    exportData: { status: "running" },
  });
  assert.equal(f.ctx.currentExportTabId, 7);
  assert.equal(f.intervals.size, 1);
  f.tick();
  f.messages.shift().cb(null, { success: true, isRunning: false });
  assert.equal(f.ctx.exportActive, false);
  assert.equal(f.ctx.currentExportTabId, null);
  assert.equal(f.intervals.size, 0);
});

test("runtime listener is idempotent and removed when popup closes", () => {
  const f = setup();
  f.ctx.attachRuntimeMessageListener();
  f.ctx.attachRuntimeMessageListener();
  assert.equal(f.listeners.size, 1);
  f.ctx.startStatusPolling();
  f.tick();
  const pending = f.messages.shift();
  f.close();
  pending.cb(null, { success: true, isRunning: true });
  assert.equal(f.listeners.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.ctx.exportActive, false);
});

test("background start error is visible and does not start polling", () => {
  const f = setup();
  f.buttons.exportBgBtn.click();
  f.messages.shift().cb(new Error("offline"), null);
  assert.equal(f.status.className, "status-line status-line--error");
  assert.equal(f.intervals.size, 0);
  assert.equal(f.ctx.exportActive, false);
});

test("rendered progress and counters update without rebuilding the view", () => {
  const f = setup();
  const data = {
    status: "running",
    filesTotal: 4,
    filesProcessed: 2,
    audioExported: 1,
    summariesExported: 2,
    filesErrored: 1,
    summaryErrors: 1,
  };
  f.ctx.updateExportStatus(data);
  assert.equal(f.nodes.get(".progress-bar").style.width, "50%");
  assert.equal(f.nodes.get(".export-val-summary").textContent, "2");
  assert.equal(f.nodes.get(".export-val-errors").textContent, "2");
  f.ctx.updateExportStatus({ ...data, filesProcessed: 4 });
  assert.equal(f.nodes.get(".progress-bar").style.width, "100%");
  f.ctx.updateExportStatus(null);
  assert.equal(f.ctx.lastExportStatusData, null);
});

for (const current of [false, true]) {
  for (const outcome of ["success", "error", "rejected"]) {
    test(`foreground current=${current} handles ${outcome}`, () => {
      const f = setup();
      f.ctx.attachRuntimeMessageListener();
      if (current) f.buttons.downloadBtn.click();
      else f.ctx.startForegroundExport("summary");
      const request = f.messages.shift();
      assert.equal(
        request.request.action,
        current ? "runExportCurrentPage" : "runExportAll"
      );
      request.cb(outcome === "error" ? new Error("offline") : null, {
        success: outcome === "success",
      });
      if (outcome === "success") {
        assert.equal(f.ctx.foregroundExportBusy, true);
        for (const fn of f.listeners)
          fn({
            action: "foregroundExportComplete",
            data: { summariesExported: 1, exportMode: "summary" },
          });
        assert.equal(f.ctx.foregroundExportBusy, false);
      } else assert.equal(f.status.className, "status-line status-line--error");
      f.close();
    });
  }
}

test("offline popup resumes an export running in another tab", () => {
  const f = setup();
  f.ctx.isPlaudTab = () => false;
  f.ctx.checkExportStatus();
  assert.equal(f.messages[0].request.action, "getAnyRunningExport");
  f.messages.shift().cb(null, {
    success: true,
    isRunning: true,
    tabId: 9,
    exportData: { status: "running" },
  });
  assert.equal(f.ctx.currentExportTabId, 9);
  f.close();
});

test("initial status timeout and late response leave state unchanged", () => {
  const f = setup();
  f.ctx.checkExportStatus();
  const pending = f.messages.shift();
  for (const fn of [...f.timers.values()]) fn();
  pending.cb(null, { success: true, isRunning: true });
  assert.equal(f.ctx.exportActive, false);
  assert.equal(f.intervals.size, 0);
});

for (const otherTab of [false, true]) {
  test(`running export without counters keeps polling; otherTab=${otherTab}`, () => {
    const f = setup();
    if (otherTab) f.ctx.isPlaudTab = () => false;
    f.ctx.checkExportStatus();
    f.messages.shift().cb(null, { success: true, isRunning: true, tabId: 9 });
    assert.equal(f.ctx.exportActive, true);
    assert.equal(f.intervals.size, 1);
    f.tick();
    f.messages.shift().cb(null, { success: true, isRunning: false });
    assert.equal(f.ctx.exportActive, false);
    assert.equal(f.intervals.size, 0);
  });
}
