import test from "node:test";
import assert from "node:assert/strict";
import { parseViewMode, VIEW_MODE_COMMANDS, VIEW_MODE_LIST, VIEW_MODES } from "./viewModes.js";

test("exposes canonical view mode vocabulary", () => {
  assert.deepEqual(VIEW_MODE_LIST, ["nvim", "split", "markdown"]);
  assert.equal(VIEW_MODES.NVIM, "nvim");
  assert.equal(VIEW_MODES.SPLIT, "split");
  assert.equal(VIEW_MODES.MARKDOWN, "markdown");
});

test("exposes command and shortcut metadata per view mode", () => {
  assert.deepEqual(VIEW_MODE_COMMANDS.nvim, { command: "NV", shortcut: "Ctrl+1" });
  assert.deepEqual(VIEW_MODE_COMMANDS.split, { command: "SP", shortcut: "Ctrl+2" });
  assert.deepEqual(VIEW_MODE_COMMANDS.markdown, { command: "MD", shortcut: "Ctrl+3" });
});

test("parses only known view mode strings", () => {
  assert.equal(parseViewMode("split"), "split");
  assert.equal(parseViewMode("invalid"), null);
});
