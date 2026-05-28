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
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: () => null,
    goForward: () => null,
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
  const markdownPreview = {
    canGoBack: () => false,
    canGoForward: () => true,
    goBack: () => ({ path: "Home.md" }),
    goForward: () => ({ path: "TODO.md" }),
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
  controller.recordTransition(null, "A.md");
  controller.recordTransition("A.md", "B.md");

  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 1 } });
  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 2 } });
  assert.deepEqual(activated, ["Home.md", "TODO.md"]);
});

test("popstate explicitly restores terminal focus after preview history navigation", async () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const listeners = {};
  const calls = [];
  const markdownPreview = {
    canGoBack: () => false,
    canGoForward: () => true,
    goBack: () => ({ path: "Home.md" }),
    goForward: () => ({ path: "TODO.md" }),
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
  controller.recordTransition(null, "A.md");
  controller.recordTransition("A.md", "B.md");

  await listeners.popstate({ state: { previewGeneration: 1, previewIndex: 1 } });
  assert.deepEqual(calls, [true]);
});

test("mouse buttons 3 and 4 map to native back and forward history actions", () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const listeners = {};
  const calls = [];
  const markdownPreview = {
    canGoBack: () => true,
    canGoForward: () => true,
    goBack: () => null,
    goForward: () => null,
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

  listeners.mouseup({ button: 3 });
  listeners.mouseup({ button: 4 });
  assert.deepEqual(calls, ["back", "focus", "forward", "focus"]);
});

test("preview pane pointer and click interactions explicitly restore terminal focus", () => {
  const backButton = makeButton();
  const forwardButton = makeButton();
  const markdownPane = makePane();
  const calls = [];
  const markdownPreview = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => null,
    goForward: () => null,
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
