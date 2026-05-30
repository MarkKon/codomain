import assert from "node:assert/strict";
import test from "node:test";
import { createViewModeRuntime } from "./viewModeRuntime.js";

function button(modeTarget) {
  const handlers = {};
  return {
    dataset: { modeTarget },
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
    getModeButtons: () => buttons,
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
    resolveViewModeCommand: (mode) => mode,
    applyViewModeTransition: ({ mode }) => {
      transitions.push(mode);
      return { ok: true, mode };
    },
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
    getModeButtons: () => [],
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
    resolveViewModeCommand: (mode) => mode,
    applyViewModeTransition: ({ mode }) => ({ ok: true, mode }),
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
