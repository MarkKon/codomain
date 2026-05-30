import { VIEW_MODES } from "./viewModes.js";

export function createTerminalRuntime({
  terminalHost,
  terminalPane,
  addWindowListener = (type, handler) => window.addEventListener(type, handler),
  createResizeObserver = (handler) => new ResizeObserver(handler),
  requestAnimationFrameFn = (handler) => requestAnimationFrame(handler),
  cancelAnimationFrameFn = (id) => cancelAnimationFrame(id),
  setTimeoutFn = (handler, ms) => setTimeout(handler, ms),
  invokeStartNeovim,
  invokeResizeNeovim,
  invokeWriteToNeovim,
  listenToEvent,
  shouldBlockImplicitTerminalFocus,
  createTerminal,
  createFitAddon,
  createUnicodeAddon,
  createWebglAddon,
}) {
  const state = {
    mode: VIEW_MODES.SPLIT,
    terminal: null,
    fit: null,
    unicode: null,
    webgl: null,
    resizeObserver: null,
    fitFrame: null,
  };

  function sendNeovimInput(data) {
    invokeWriteToNeovim({ data }).catch((error) => {
      state.terminal.writeln(`\r\n[codomain input error: ${String(error)}]`);
    });
  }

  function shouldForwardRepeatedPrintableKey(event) {
    return (
      event.type === "keydown" &&
      event.repeat &&
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    );
  }

  function focusTerminal({ explicit = false } = {}) {
    if (!state.terminal) return;
    if (!explicit && shouldBlockImplicitTerminalFocus(state.mode)) return;
    state.terminal.focus();
  }

  async function fitTerminalNow() {
    if (!state.fit || state.mode === VIEW_MODES.MARKDOWN) return;
    if (terminalHost.clientWidth === 0 || terminalHost.clientHeight === 0) return;
    state.fit.fit();
    await invokeResizeNeovim({
      rows: state.terminal.rows,
      cols: state.terminal.cols,
    }).catch(() => {});
  }

  function scheduleTerminalFit(nextMode = state.mode) {
    if (!state.fit || nextMode === VIEW_MODES.MARKDOWN) return;
    if (state.fitFrame) cancelAnimationFrameFn(state.fitFrame);
    state.fitFrame = requestAnimationFrameFn(() => {
      state.fitFrame = null;
      fitTerminalNow();
      setTimeoutFn(fitTerminalNow, 40);
      setTimeoutFn(fitTerminalNow, 140);
    });
  }

  function setMode(mode) {
    state.mode = mode;
  }

  function setupTerminal() {
    state.terminal = createTerminal();
    state.terminal.attachCustomKeyEventHandler?.((event) => {
      if (shouldForwardRepeatedPrintableKey(event)) {
        event.preventDefault();
        sendNeovimInput(event.key);
        return false;
      }
      return true;
    });
    state.fit = createFitAddon();
    state.unicode = createUnicodeAddon();
    state.webgl = createWebglAddon();
    state.terminal.loadAddon(state.fit);
    state.terminal.loadAddon(state.unicode);
    if (state.terminal.unicode) state.terminal.unicode.activeVersion = "11";
    state.terminal.open(terminalHost);
    try {
      if (state.webgl) {
        state.terminal.loadAddon(state.webgl);
        state.webgl.onContextLoss?.(() => {
          state.webgl.dispose();
          state.webgl = null;
        });
      }
    } catch {
      state.webgl = null;
    }
    state.terminal.onData(sendNeovimInput);
    terminalPane.addEventListener("pointerdown", focusTerminal);
    terminalPane.addEventListener("click", focusTerminal);
    state.resizeObserver = createResizeObserver(scheduleTerminalFit);
    state.resizeObserver.observe(terminalPane);
    state.resizeObserver.observe(terminalHost);
    addWindowListener("resize", scheduleTerminalFit);
  }

  async function startTerminal(root) {
    await fitTerminalNow();
    const { rows, cols } = state.terminal;
    await invokeStartNeovim({ root, rows, cols });
    await listenToEvent("nvim://data", (event) => state.terminal.write(event.payload));
    await listenToEvent("nvim://exit", () => state.terminal.writeln("\r\n[neovim exited]"));
    scheduleTerminalFit();
  }

  return {
    state,
    setMode,
    setupTerminal,
    startTerminal,
    scheduleTerminalFit,
    fitTerminalNow,
    focusTerminal,
    sendNeovimInput,
  };
}
