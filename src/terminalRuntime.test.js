import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalRuntime } from "./terminalRuntime.js";

test("fits terminal and resizes neovim when visible and mode allows fitting", async () => {
  const resizeCalls = [];
  const runtime = createTerminalRuntime({
    terminalHost: { clientWidth: 900, clientHeight: 700 },
    invokeResizeNeovim: async ({ rows, cols }) => resizeCalls.push([rows, cols]),
    shouldBlockImplicitTerminalFocus: () => false,
    createTerminal: () => ({ rows: 44, cols: 140, focus() {}, writeln() {} }),
    createFitAddon: () => ({ fit: () => resizeCalls.push(["fit"]) }),
    createUnicodeAddon: () => ({}),
    createWebglAddon: () => null,
  });
  runtime.state.terminal = { rows: 44, cols: 140, focus() {}, writeln() {} };
  runtime.state.fit = { fit: () => resizeCalls.push(["fit"]) };
  runtime.state.mode = "split";

  await runtime.fitTerminalNow();
  assert.deepEqual(resizeCalls, [["fit"], [44, 140]]);
});

test("blocks implicit terminal focus in markdown mode but allows explicit focus", () => {
  let focusCount = 0;
  const runtime = createTerminalRuntime({
    terminalHost: { clientWidth: 0, clientHeight: 0 },
    invokeResizeNeovim: async () => {},
    shouldBlockImplicitTerminalFocus: (mode) => mode === "markdown",
    createTerminal: () => ({ rows: 20, cols: 80, focus() {}, writeln() {} }),
    createFitAddon: () => ({ fit() {} }),
    createUnicodeAddon: () => ({}),
    createWebglAddon: () => null,
  });
  runtime.state.terminal = { focus: () => focusCount++ };
  runtime.state.mode = "markdown";

  runtime.focusTerminal();
  runtime.focusTerminal({ explicit: true });
  assert.equal(focusCount, 1);
});
