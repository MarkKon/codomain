import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownWorkspace } from "./markdownWorkspace.js";

test("loads markdown and applies preview file", async () => {
  const applied = [];
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async ({ root, path }) => ({ path, content: root }),
    applyPreviewFile: (file) => applied.push(file),
    showPreviewEmpty: () => {},
    syncPreviewNavigationButtons: () => {},
    openMarkdownInNeovim: async () => {},
  });

  await workspace.loadMarkdown("README.md", true);
  assert.deepEqual(applied, [{ path: "README.md", content: "/root" }]);
});

test("tolerates missing README by showing empty preview and syncing navigation", async () => {
  let emptyCount = 0;
  let syncCount = 0;
  const workspace = createMarkdownWorkspace({
    getRoot: () => "/root",
    readMarkdown: async () => {
      throw new Error("missing");
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

  await workspace.loadMarkdown("README.md", true);
  assert.equal(emptyCount, 1);
  assert.equal(syncCount, 1);
});
