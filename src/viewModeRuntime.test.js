import assert from "node:assert/strict";
import test from "node:test";
import { createViewModeRuntime, shouldBlockImplicitTerminalFocus } from "./viewModeRuntime.js";

function button(modeTarget) {
  const handlers = {};
  return {
    dataset: { modeTarget },
    toggleAttribute() {},
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    click() {
      handlers.click?.();
    },
  };
}

test("wires mode buttons and keyboard shortcuts through transition policy", () => {
  const buttons = [button("nvim"), button("split"), button("markdown")];
  const listeners = {};
  const transitions = [];
  const runtime = createViewModeRuntime({
    initialMode: "split",
    shell: { dataset: {} },
    getModeButtons: () => buttons,
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
    setTimeoutFn: (fn) => fn(),
    onModeChanged: (mode) => transitions.push(mode),
    scheduleTerminalFit: () => {},
    requestTerminalFocus: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    resetZoom: () => {},
  });

  runtime.setupModes();
  buttons[0].click();
  listeners.keydown({ key: "2", ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} });

  assert.deepEqual(transitions, ["split", "nvim", "split"]);
});

test("routes zoom shortcuts to zoom commands", () => {
  const listeners = {};
  const calls = [];
  const runtime = createViewModeRuntime({
    initialMode: "split",
    shell: { dataset: {} },
    getModeButtons: () => [],
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
    setTimeoutFn: (fn) => fn(),
    scheduleTerminalFit: () => {},
    requestTerminalFocus: () => {},
    zoomIn: () => calls.push("in"),
    zoomOut: () => calls.push("out"),
    resetZoom: () => calls.push("reset"),
  });

  runtime.setupModes();
  listeners.keydown({ key: "+", ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} });
  listeners.keydown({ key: "-", ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} });
  listeners.keydown({ key: "0", ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} });

  assert.deepEqual(calls, ["in", "out", "reset"]);
});

test("applies transition side effects and accepts menu payload objects", () => {
  const shell = { dataset: {} };
  const calls = [];
  const modeButtons = [
    { dataset: { modeTarget: "nvim" }, toggleAttribute: (name, on) => calls.push(["nvim", name, on]) },
    { dataset: { modeTarget: "split" }, toggleAttribute: (name, on) => calls.push(["split", name, on]) },
  ];
  let fitArg = null;
  let focusCount = 0;
  const runtime = createViewModeRuntime({
    initialMode: "split",
    shell,
    getModeButtons: () => modeButtons,
    setTimeoutFn: (fn) => fn(),
    scheduleTerminalFit: (mode) => {
      fitArg = mode;
    },
    requestTerminalFocus: () => {
      focusCount += 1;
    },
    zoomIn: () => {},
    zoomOut: () => {},
    resetZoom: () => {},
  });

  const changed = runtime.setMode({ mode: "split" });

  assert.equal(changed, true);
  assert.equal(shell.dataset.mode, "split");
  assert.equal(fitArg, "split");
  assert.equal(focusCount, 1);
  assert.deepEqual(calls, [
    ["nvim", "aria-pressed", false],
    ["split", "aria-pressed", true],
  ]);
});

test("rejects unknown view mode command payloads", () => {
  const runtime = createViewModeRuntime({
    initialMode: "split",
    shell: { dataset: {} },
    getModeButtons: () => [],
    scheduleTerminalFit: () => {},
    requestTerminalFocus: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    resetZoom: () => {},
  });

  assert.equal(runtime.setMode("bogus"), false);
  assert.equal(runtime.setMode({ mode: "bogus" }), false);
  assert.equal(runtime.mode(), "split");
});

test("markdown blocks implicit terminal focus policy", () => {
  assert.equal(shouldBlockImplicitTerminalFocus("markdown"), true);
  assert.equal(shouldBlockImplicitTerminalFocus("split"), false);
});
