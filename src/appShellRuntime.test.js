import assert from "node:assert/strict";
import test from "node:test";
import { createAppShellRuntime } from "./appShellRuntime.js";

test("startup initializes root, starts neovim, loads README, wires listeners, and focuses terminal", async () => {
  const calls = [];
  const runtime = createAppShellRuntime({
    initializeRoot: async () => "/tmp/root",
    onRootInitialized: (root) => calls.push(["onRootInitialized", root]),
    setupModes: () => calls.push(["setupModes"]),
    setupPreviewNavigation: () => calls.push(["setupPreviewNavigation"]),
    setupTerminal: () => calls.push(["setupTerminal"]),
    startTerminal: async () => calls.push(["startTerminal"]),
    loadReadmeMarkdown: async (tolerateMissing) => calls.push(["loadReadmeMarkdown", tolerateMissing]),
    wirePreviewRefresh: async () => calls.push(["wirePreviewRefresh"]),
    listenForModeChanges: async () => calls.push(["listenForModeChanges"]),
    focusTerminal: () => calls.push(["focusTerminal"]),
  });

  await runtime.boot();

  assert.deepEqual(calls, [
    ["onRootInitialized", "/tmp/root"],
    ["setupModes"],
    ["setupPreviewNavigation"],
    ["setupTerminal"],
    ["startTerminal"],
    ["loadReadmeMarkdown", true],
    ["wirePreviewRefresh"],
    ["listenForModeChanges"],
    ["focusTerminal"],
  ]);
});

test("root folder change stops neovim, resets preview and navigation, restarts neovim, loads README, fits, and focuses", async () => {
  const calls = [];
  const runtime = createAppShellRuntime({
    initializeRoot: async () => "",
    onRootInitialized: () => {},
    setupModes: () => {},
    setupPreviewNavigation: () => {},
    setupTerminal: () => {},
    startTerminal: async () => {},
    loadReadmeMarkdown: async (tolerateMissing) => calls.push(["loadReadmeMarkdown", tolerateMissing]),
    wirePreviewRefresh: async () => {},
    listenForModeChanges: async () => {},
    focusTerminal: () => calls.push(["focusTerminal"]),
    stopNeovim: async () => calls.push(["stopNeovim"]),
    onRootChanged: (root) => calls.push(["onRootChanged", root]),
    resetMarkdownPreview: () => calls.push(["resetMarkdownPreview"]),
    resetPreviewNavigation: () => calls.push(["resetPreviewNavigation"]),
    resetTerminal: () => calls.push(["resetTerminal"]),
    fitTerminalNow: () => calls.push(["fitTerminalNow"]),
    getTerminalDimensions: () => ({ rows: 41, cols: 132 }),
    startNeovim: async ({ root, rows, cols }) => calls.push(["startNeovim", root, rows, cols]),
    scheduleTerminalFit: () => calls.push(["scheduleTerminalFit"]),
  });

  await runtime.changeRoot("/tmp/next");

  assert.deepEqual(calls, [
    ["stopNeovim"],
    ["onRootChanged", "/tmp/next"],
    ["resetMarkdownPreview"],
    ["resetPreviewNavigation"],
    ["resetTerminal"],
    ["fitTerminalNow"],
    ["startNeovim", "/tmp/next", 41, 132],
    ["loadReadmeMarkdown", true],
    ["scheduleTerminalFit"],
    ["focusTerminal"],
  ]);
});
