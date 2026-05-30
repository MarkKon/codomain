import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewNavigationController } from "./previewNavigation.js";

function makeButton() {
  const handlers = new Map();
  return {
    disabled: false,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    click() {
      handlers.get("click")?.();
    },
  };
}

function makePane() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    trigger(type, event = {}) {
      handlers.get(type)?.(event);
    },
  };
}

test("syncs disabled state and delegates button clicks to browser history", () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const calls = [];
  const markdownPreview = {
    renderFile: () => false,
  };
  const historyApi = {
    pushState() {},
    replaceState() {},
    back() {
      calls.push("back");
    },
    forward() {
      calls.push("forward");
    },
  };

  const controller = createPreviewNavigationController({
    markdownPreview,
    backButton,
    forwardButton,
    markdownPane,
    focusTerminal: () => calls.push("focus"),
    activateMarkdownFile: async () => {},
    historyApi,
    locationHref: () => "http://app",
    addWindowListener: () => {},
  });
  controller.setup();
  controller.recordTransition({ path: "Home.md", content: "# Home" }, { path: "TODO.md", content: "# TODO" });

  assert.equal(backButton.disabled, false);
  assert.equal(forwardButton.disabled, true);
  backButton.click();
  forwardButton.click();
  assert.deepEqual(calls, ["back", "focus"]);
});

test("popstate navigates preview history and activates markdown file in neovim", async () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const listeners = {};
  const activated = [];
  const rendered = [];
  const markdownPreview = {
    renderFile: (file) => {
      rendered.push(file.path);
      return true;
    },
  };
  const historyApi = {
    pushState() {},
    replaceState() {},
    back() {},
    forward() {},
  };

  const controller = createPreviewNavigationController({
    markdownPreview,
    backButton,
    forwardButton,
    markdownPane,
    focusTerminal: () => {},
    activateMarkdownFile: async (path) => activated.push(path),
    historyApi,
    locationHref: () => "http://app",
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
  });
  controller.setup();
  controller.recordTransition(null, { path: "A.md", content: "# A" });
  controller.recordTransition({ path: "A.md", content: "# A" }, { path: "B.md", content: "# B" });

  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 1 } });
  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 2 } });
  assert.deepEqual(rendered, ["A.md", "B.md"]);
  assert.deepEqual(activated, ["A.md", "B.md"]);
});

test("popstate explicitly restores terminal focus after preview history navigation", async () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const listeners = {};
  const calls = [];
  const markdownPreview = {
    renderFile: () => true,
  };
  const historyApi = {
    pushState() {},
    replaceState() {},
    back() {},
    forward() {},
  };

  const controller = createPreviewNavigationController({
    markdownPreview,
    backButton,
    forwardButton,
    markdownPane,
    focusTerminal: ({ explicit }) => calls.push(explicit),
    activateMarkdownFile: async () => {},
    historyApi,
    locationHref: () => "http://app",
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
  });
  controller.setup();
  controller.recordTransition(null, { path: "A.md", content: "# A" });
  controller.recordTransition({ path: "A.md", content: "# A" }, { path: "B.md", content: "# B" });

  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 1 } });
  assert.deepEqual(calls, [true]);
});

test("mouse buttons 3 and 4 map to native back and forward history actions", async () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const listeners = {};
  const calls = [];
  const markdownPreview = {
    renderFile: () => false,
  };
  const historyApi = {
    pushState() {},
    replaceState() {},
    back() {
      calls.push("back");
    },
    forward() {
      calls.push("forward");
    },
  };

  const controller = createPreviewNavigationController({
    markdownPreview,
    backButton,
    forwardButton,
    markdownPane,
    focusTerminal: () => calls.push("focus"),
    activateMarkdownFile: async () => {},
    historyApi,
    locationHref: () => "http://app",
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
  });
  controller.setup();
  controller.recordTransition({ path: "Home.md", content: "# Home" }, { path: "TODO.md", content: "# TODO" });
  controller.recordTransition({ path: "TODO.md", content: "# TODO" }, { path: "Daily Log.md", content: "# Daily Log" });

  listeners.mouseup({ button: 3 });
  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 1 } });
  listeners.mouseup({ button: 4 });
  assert.deepEqual(calls, ["back", "focus", "focus", "forward", "focus"]);
});

test("same-path refresh updates snapshot used by later browser back navigation", async () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const listeners = {};
  const rendered = [];
  const markdownPreview = {
    renderFile: (file) => {
      rendered.push([file.path, file.content]);
      return true;
    },
  };
  const historyApi = {
    pushState() {},
    replaceState() {},
    back() {},
    forward() {},
  };

  const controller = createPreviewNavigationController({
    markdownPreview,
    backButton,
    forwardButton,
    markdownPane,
    focusTerminal: () => {},
    activateMarkdownFile: async () => {},
    historyApi,
    locationHref: () => "http://app",
    addWindowListener: (type, handler) => {
      listeners[type] = handler;
    },
  });
  controller.setup();

  controller.recordTransition(null, { path: "Home.md", content: "# Home v1" });
  controller.recordTransition("Home.md", "Home.md", {
    previousFile: { path: "Home.md", content: "# Home v1" },
    nextFile: { path: "Home.md", content: "# Home v2" },
  });
  controller.recordTransition({ path: "Home.md", content: "# Home v2" }, { path: "TODO.md", content: "# TODO" });

  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 1 } });
  assert.deepEqual(rendered, [["Home.md", "# Home v2"]]);
});

test("preview pane pointer and click interactions explicitly restore terminal focus", () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const calls = [];
  const markdownPreview = {
    renderFile: () => false,
  };
  const historyApi = {
    pushState() {},
    replaceState() {},
    back() {},
    forward() {},
  };

  const controller = createPreviewNavigationController({
    markdownPreview,
    backButton,
    forwardButton,
    markdownPane,
    focusTerminal: ({ explicit }) => calls.push(explicit),
    activateMarkdownFile: async () => {},
    historyApi,
    locationHref: () => "http://app",
    addWindowListener: () => {},
  });
  controller.setup();

  markdownPane.trigger("pointerup");
  markdownPane.trigger("click");
  assert.deepEqual(calls, [true, true]);
});
