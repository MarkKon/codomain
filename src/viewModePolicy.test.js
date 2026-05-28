import test from "node:test";
import assert from "node:assert/strict";
import { applyViewModeTransition, resolveViewModeCommand } from "./viewModePolicy.js";

test("rejects unknown view mode command payloads", () => {
  assert.equal(resolveViewModeCommand("bogus"), null);
  assert.equal(resolveViewModeCommand({ mode: "bogus" }), null);
  assert.equal(resolveViewModeCommand({ mode: "split" }), "split");
});

test("applies transition side effects for valid view mode", () => {
  const shell = { dataset: {} };
  const calls = [];
  const buttons = [
    { dataset: { modeTarget: "nvim" }, toggleAttribute: (name, on) => calls.push(["nvim", name, on]) },
    { dataset: { modeTarget: "split" }, toggleAttribute: (name, on) => calls.push(["split", name, on]) },
  ];

  const originalSetTimeout = globalThis.window?.setTimeout;
  globalThis.window = { setTimeout: (fn) => fn() };
  let fitCount = 0;
  let focusCount = 0;

  const result = applyViewModeTransition({
    mode: "split",
    shell,
    modeButtons: buttons,
    scheduleTerminalFit: () => fitCount++,
    requestTerminalFocus: () => focusCount++,
  });

  if (originalSetTimeout) globalThis.window.setTimeout = originalSetTimeout;

  assert.equal(result.ok, true);
  assert.equal(shell.dataset.mode, "split");
  assert.equal(fitCount, 1);
  assert.equal(focusCount, 1);
  assert.deepEqual(calls, [
    ["nvim", "aria-pressed", false],
    ["split", "aria-pressed", true],
  ]);
});
