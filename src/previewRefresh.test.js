import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewRefreshController, wirePreviewRefresh } from "./previewRefresh.js";

function createTimerHarness() {
  let nextId = 1;
  const timeouts = new Map();
  const cleared = [];

  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      cleared.push(id);
      timeouts.delete(id);
    },
    runTimeout(id) {
      const timeout = timeouts.get(id);
      if (!timeout) return;
      timeouts.delete(id);
      timeout.callback();
    },
    timeoutCount() {
      return timeouts.size;
    },
    ids() {
      return Array.from(timeouts.keys());
    },
    cleared,
  };
}

test("coalesces rapid refresh requests into one deferred refresh", async () => {
  const timer = createTimerHarness();
  const reads = [];
  const preview = {
    currentPath: () => "Home.md",
    renderFile: () => true,
  };
  const controller = createPreviewRefreshController({
    readActiveMarkdownFile: async () => {
      reads.push("read");
      return { path: "TODO.md", content: "# TODO" };
    },
    markdownPreview: preview,
    onPathTransition: () => {},
    onRenderedPathChange: () => {},
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });

  controller.scheduleRefresh();
  controller.scheduleRefresh();
  controller.scheduleRefresh();

  assert.equal(timer.timeoutCount(), 1);
  assert.deepEqual(timer.cleared, [1, 2]);

  timer.runTimeout(timer.ids()[0]);
  await Promise.resolve();
  assert.equal(reads.length, 1);
});

test("suppresses overlapping refresh while one is in flight", async () => {
  let resolveRead;
  let readCount = 0;
  const preview = {
    currentPath: () => "Home.md",
    renderFile: () => false,
  };
  const controller = createPreviewRefreshController({
    readActiveMarkdownFile: async () =>
      new Promise((resolve) => {
        readCount += 1;
        resolveRead = resolve;
      }),
    markdownPreview: preview,
    onPathTransition: () => {},
    onRenderedPathChange: () => {},
  });

  const first = controller.refreshFromActiveMarkdownFile();
  await Promise.resolve();
  await controller.refreshFromActiveMarkdownFile();
  assert.equal(readCount, 1);

  resolveRead({ path: "Home.md", content: "# Home" });
  await first;
});

test("no-ops when no active markdown file is returned", async () => {
  let rendered = false;
  let transitioned = false;
  let synced = false;
  const preview = {
    currentPath: () => "Home.md",
    renderFile: () => {
      rendered = true;
      return true;
    },
  };
  const controller = createPreviewRefreshController({
    readActiveMarkdownFile: async () => null,
    markdownPreview: preview,
    onPathTransition: () => {
      transitioned = true;
    },
    onRenderedPathChange: () => {
      synced = true;
    },
  });

  await controller.refreshFromActiveMarkdownFile();
  assert.equal(rendered, false);
  assert.equal(transitioned, false);
  assert.equal(synced, false);
});

test("records transition and sync when displayed markdown file path changes", async () => {
  const transitions = [];
  let syncCount = 0;
  const preview = {
    currentPath: () => "Home.md",
    renderFile: () => true,
  };
  const controller = createPreviewRefreshController({
    readActiveMarkdownFile: async () => ({ path: "TODO.md", content: "# TODO" }),
    markdownPreview: preview,
    onPathTransition: (previousPath, nextPath) => transitions.push([previousPath, nextPath]),
    onRenderedPathChange: () => {
      syncCount += 1;
    },
  });

  await controller.refreshFromActiveMarkdownFile();
  assert.deepEqual(transitions, [["Home.md", "TODO.md"]]);
  assert.equal(syncCount, 1);
});

test("does not re-trigger transition or sync for duplicate displayed markdown file", async () => {
  let transitionCount = 0;
  let syncCount = 0;
  const preview = {
    currentPath: () => "Home.md",
    renderFile: () => false,
  };
  const controller = createPreviewRefreshController({
    readActiveMarkdownFile: async () => ({ path: "Home.md", content: "# Home" }),
    markdownPreview: preview,
    onPathTransition: () => {
      transitionCount += 1;
    },
    onRenderedPathChange: () => {
      syncCount += 1;
    },
  });

  await controller.refreshFromActiveMarkdownFile();
  assert.equal(transitionCount, 0);
  assert.equal(syncCount, 0);
});

test("wires buffer-change scheduling and 1s polling to preview refresh controller", async () => {
  const listeners = [];
  const intervals = [];
  const controller = {
    scheduleRefresh() {},
    refreshFromActiveMarkdownFile() {},
  };

  await wirePreviewRefresh({
    listenToEvent: async (eventName, handler) => {
      listeners.push([eventName, handler]);
    },
    setIntervalFn: (handler, ms) => {
      intervals.push([handler, ms]);
    },
    previewRefresh: controller,
  });

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], "nvim://buffer-changed");
  assert.equal(listeners[0][1], controller.scheduleRefresh);
  assert.deepEqual(intervals, [[controller.refreshFromActiveMarkdownFile, 1000]]);
});
