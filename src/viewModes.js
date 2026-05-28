export const VIEW_MODES = Object.freeze({
  NVIM: "nvim",
  SPLIT: "split",
  MARKDOWN: "markdown",
});

export const VIEW_MODE_LIST = Object.freeze(Object.values(VIEW_MODES));

export const VIEW_MODE_COMMANDS = Object.freeze({
  nvim: Object.freeze({ command: "NV", shortcut: "Ctrl+1" }),
  split: Object.freeze({ command: "SP", shortcut: "Ctrl+2" }),
  markdown: Object.freeze({ command: "MD", shortcut: "Ctrl+3" }),
});

export function isViewMode(value) {
  return typeof value === "string" && VIEW_MODE_LIST.includes(value);
}

export function parseViewMode(value) {
  return isViewMode(value) ? value : null;
}
