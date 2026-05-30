import { parseViewMode, VIEW_MODES } from "./viewModes.js";

function resolveViewModeCommand(input) {
  if (typeof input === "string") return parseViewMode(input);
  if (input && typeof input === "object") return parseViewMode(input.mode);
  return null;
}

function applyViewModeTransition({
  mode,
  shell,
  modeButtons,
  scheduleTerminalFit,
  requestTerminalFocus,
  setTimeoutFn,
  focusDelayMs = 50,
}) {
  shell.dataset.mode = mode;
  modeButtons.forEach((button) => {
    button.toggleAttribute("aria-pressed", button.dataset.modeTarget === mode);
  });
  scheduleTerminalFit(mode);

  if (mode !== VIEW_MODES.MARKDOWN) {
    setTimeoutFn(requestTerminalFocus, focusDelayMs);
  }

  return mode;
}

export function shouldBlockImplicitTerminalFocus(mode) {
  return parseViewMode(mode) === VIEW_MODES.MARKDOWN;
}

export function createViewModeRuntime({
  initialMode = VIEW_MODES.SPLIT,
  shell,
  getModeButtons,
  addWindowListener = (type, handler) => window.addEventListener(type, handler),
  setTimeoutFn = (handler, delayMs) => window.setTimeout(handler, delayMs),
  scheduleTerminalFit,
  requestTerminalFocus,
  zoomIn,
  zoomOut,
  resetZoom,
  onModeChanged = () => {},
}) {
  let mode = initialMode;

  function setMode(next) {
    const resolvedMode = resolveViewModeCommand(next);
    if (!resolvedMode) return false;
    mode = applyViewModeTransition({
      mode: resolvedMode,
      shell,
      modeButtons: getModeButtons(),
      scheduleTerminalFit,
      requestTerminalFocus,
      setTimeoutFn,
    });
    onModeChanged(mode);
    return true;
  }

  function setupModes() {
    getModeButtons().forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.modeTarget));
    });
    addWindowListener("keydown", (event) => {
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      if (!hasPrimaryModifier || event.altKey) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        setMode(VIEW_MODES.NVIM);
      }
      if (event.key === "2") {
        event.preventDefault();
        setMode(VIEW_MODES.SPLIT);
      }
      if (event.key === "3") {
        event.preventDefault();
        setMode(VIEW_MODES.MARKDOWN);
      }
    });
    setMode(mode);
  }

  return {
    mode: () => mode,
    setMode,
    setupModes,
  };
}
