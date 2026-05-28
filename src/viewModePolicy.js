import { parseViewMode, VIEW_MODES } from "./viewModes.js";

export function applyViewModeTransition({
  mode,
  shell,
  modeButtons,
  scheduleTerminalFit,
  requestTerminalFocus,
  focusDelayMs = 50,
}) {
  const nextMode = parseViewMode(mode);
  if (!nextMode) return { ok: false, reason: "unknown-mode" };

  shell.dataset.mode = nextMode;
  modeButtons.forEach((button) => {
    button.toggleAttribute("aria-pressed", button.dataset.modeTarget === nextMode);
  });
  scheduleTerminalFit(nextMode);

  if (nextMode !== VIEW_MODES.MARKDOWN) {
    window.setTimeout(requestTerminalFocus, focusDelayMs);
  }

  return {
    ok: true,
    mode: nextMode,
    shouldAllowTerminalFocusFromPreview: true,
    shouldFitTerminal: nextMode !== VIEW_MODES.MARKDOWN,
  };
}

export function shouldBlockImplicitTerminalFocus(mode) {
  return parseViewMode(mode) === VIEW_MODES.MARKDOWN;
}

export function resolveViewModeCommand(input) {
  if (typeof input === "string") return parseViewMode(input);
  if (input && typeof input === "object") return parseViewMode(input.mode);
  return null;
}
