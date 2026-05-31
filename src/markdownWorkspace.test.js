import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownWorkspace } from "./markdownWorkspace.js";

test("loads markdown and applies preview file", async () => {
  const applied = [];
  const opened = [];
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async ({ root, path }) => ({ path, content: root }),
    applyPreviewFile: (file) => applied.push(file),
    showPreviewEmpty: () => {},
    syncPreviewNavigationButtons: () => {},
    openMarkdownInNeovim: async ({ path }) => opened.push(path),
  });

  await workspace.loadMarkdown("README.md", true);
  assert.deepEqual(applied, [{ path: "README.md", content: "/root" }]);
  assert.deepEqual(opened, ["README.md"]);
});

test("tolerates missing README by showing empty preview and syncing navigation", async () => {
  let emptyCount = 0;
  let syncCount = 0;
  let openCount = 0;
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async () => {
      throw new Error("READ_MARKDOWN_NOT_FOUND:README.md");
    },
    applyPreviewFile: () => {},
    showPreviewEmpty: () => {
      emptyCount += 1;
    },
    syncPreviewNavigationButtons: () => {
      syncCount += 1;
    },
    openMarkdownInNeovim: async () => {
      openCount += 1;
    },
  });

  await workspace.loadMarkdown("README.md", true);
  assert.equal(emptyCount, 1);
  assert.equal(syncCount, 1);
  assert.equal(openCount, 0);
});

test("does not tolerate non-missing read failures for README", async () => {
  let emptyCount = 0;
  let syncCount = 0;
  const readError = new Error("permission denied");
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async () => {
      throw readError;
    },
    applyPreviewFile: () => {},
    showPreviewEmpty: () => {
      emptyCount += 1;
    },
    syncPreviewNavigationButtons: () => {
      syncCount += 1;
    },
    openMarkdownInNeovim: async () => {},
  });

  await assert.rejects(() => workspace.loadMarkdown("README.md", true), readError);
  assert.equal(emptyCount, 0);
  assert.equal(syncCount, 0);
});

test("does not tolerate read errors that only contain missing sentinel as substring", async () => {
  let emptyCount = 0;
  let syncCount = 0;
  const readError = new Error("prefix READ_MARKDOWN_NOT_FOUND:README.md suffix");
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async () => {
      throw readError;
    },
    applyPreviewFile: () => {},
    showPreviewEmpty: () => {
      emptyCount += 1;
    },
    syncPreviewNavigationButtons: () => {
      syncCount += 1;
    },
    openMarkdownInNeovim: async () => {},
  });

  await assert.rejects(() => workspace.loadMarkdown("README.md", true), readError);
  assert.equal(emptyCount, 0);
  assert.equal(syncCount, 0);
});

test("propagates activation failure after successful README load", async () => {
  let emptyCount = 0;
  const activationError = new Error("nvim activation failed");
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async () => ({ path: "README.md", content: "# readme" }),
    applyPreviewFile: () => {},
    showPreviewEmpty: () => {
      emptyCount += 1;
    },
    syncPreviewNavigationButtons: () => {},
    openMarkdownInNeovim: async () => {
      throw activationError;
    },
  });

  await assert.rejects(() => workspace.loadMarkdown("README.md", true), activationError);
  assert.equal(emptyCount, 0);
});
