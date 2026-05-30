import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import katex from "katex";
import { escapeHtml } from "./markdownEscaping.js";
import { createMarkdownPreview } from "./markdownPreview.js";
import { createPreviewNavigationController } from "./previewNavigation.js";
import { createPreviewRefreshController, wirePreviewRefresh } from "./previewRefresh.js";
import {
  applyViewModeTransition,
  resolveViewModeCommand,
  shouldBlockImplicitTerminalFocus,
} from "./viewModePolicy.js";
import { VIEW_MODES } from "./viewModes.js";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const state = {
  root: "",
  mode: VIEW_MODES.SPLIT,
  terminal: null,
  fit: null,
  unicode: null,
  webgl: null,
  resizeObserver: null,
  fitFrame: null,
};

document.querySelector("#app").innerHTML = `
  <main class="shell" data-mode="split">
    <header class="topbar" data-tauri-drag-region>
      <button class="path-label" id="rootLabel" title="Choose root folder"></button>
      <div class="mode-switch" role="group" aria-label="View mode">
        <button data-mode-target="nvim" title="Neovim full view" aria-label="Neovim full view">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5h14v14H5z" />
            <path d="m9 9 3 3-3 3" />
            <path d="M13 15h3" />
          </svg>
        </button>
        <button data-mode-target="split" title="Split view" aria-label="Split view">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5h14v14H5z" />
            <path d="M12 5v14" />
          </svg>
        </button>
        <button data-mode-target="markdown" title="Markdown full view" aria-label="Markdown full view">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16v10H4z" />
            <path d="M7 14v-4l2 2 2-2v4" />
            <path d="M14 10v4" />
            <path d="m12.5 12.5 1.5 1.5 1.5-1.5" />
          </svg>
        </button>
      </div>
    </header>
    <section class="workspace">
      <section class="pane pane-terminal" aria-label="Neovim">
        <div id="terminal"></div>
      </section>
      <section class="pane pane-markdown" aria-label="Markdown preview">
        <article id="preview" class="preview"></article>
        <div class="preview-nav" role="group" aria-label="Markdown history">
          <button id="previewBack" title="Back" aria-label="Back">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button id="previewForward" title="Forward" aria-label="Forward">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
      </section>
    </section>
  </main>
`;

const rootLabel = document.querySelector("#rootLabel");
const previewBackButton = document.querySelector("#previewBack");
const previewForwardButton = document.querySelector("#previewForward");
const preview = document.querySelector("#preview");
const shell = document.querySelector(".shell");
const terminalPane = document.querySelector(".pane-terminal");
const markdownPane = document.querySelector(".pane-markdown");
const terminalHost = document.querySelector("#terminal");
const markdownPreview = createMarkdownPreview({
  host: preview,
  renderMath,
  openWikilink: ({ fromPath, target }) =>
    invoke("open_wikilink_in_neovim", { fromPath, target }),
  onPathTransition: (previousPath, nextPath, details) => {
    previewNavigation.recordTransition(previousPath, nextPath, details);
    previewNavigation.syncButtons();
  },
});
const previewNavigation = createPreviewNavigationController({
  markdownPreview,
  backButton: previewBackButton,
  forwardButton: previewForwardButton,
  markdownPane,
  focusTerminal,
  activateMarkdownFile,
});
const previewRefresh = createPreviewRefreshController({
  readActiveMarkdownFile: () => invoke("read_current_neovim_markdown"),
  markdownPreview,
  onPathTransition: (previousPath, nextPath, details) =>
    previewNavigation.recordTransition(previousPath, nextPath, details),
  onRenderedPathChange: () => previewNavigation.syncButtons(),
  setTimeoutFn: window.setTimeout.bind(window),
  clearTimeoutFn: window.clearTimeout.bind(window),
});

boot().catch((error) => {
  preview.innerHTML = `<div class="empty-state"><h1>Codomain could not start</h1><p>${escapeHtml(String(error))}</p></div>`;
});

async function boot() {
  state.root = await invoke("initialize_root");
  rootLabel.textContent = state.root;
  rootLabel.addEventListener("click", chooseRootFolder);
  setupModes();
  setupPreviewNavigation();
  setupTerminal();
  await startTerminal();
  await loadMarkdown("README.md", true);
  await wirePreviewRefresh({
    listenToEvent: listen,
    setIntervalFn: window.setInterval.bind(window),
    previewRefresh,
  });
  await listen("codomain://set-mode", (event) => setMode(event.payload));
  focusTerminal();
}

async function chooseRootFolder() {
  try {
    const root = await invoke("choose_root_folder", { currentRoot: state.root });
    if (!root || root === state.root) return;
    await changeRoot(root);
  } catch (error) {
    markdownPreview.showError("Could not change root folder", error);
  }
}

async function changeRoot(root) {
  await invoke("stop_neovim");
  state.root = root;
  rootLabel.textContent = root;
  markdownPreview.reset();
  previewNavigation.resetHistoryState();
  state.terminal.reset();
  fitTerminalNow();
  await invoke("start_neovim", {
    root: state.root,
    rows: state.terminal.rows,
    cols: state.terminal.cols,
  });
  await loadMarkdown("README.md", true);
  scheduleTerminalFit();
  focusTerminal();
}

function setupModes() {
  document.querySelectorAll("[data-mode-target]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.modeTarget));
  });

  window.addEventListener("keydown", (event) => {
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

  setMode(state.mode);
}

function setMode(mode) {
  const resolvedMode = resolveViewModeCommand(mode);
  if (!resolvedMode) return false;
  const result = applyViewModeTransition({
    mode: resolvedMode,
    shell,
    modeButtons: document.querySelectorAll("[data-mode-target]"),
    scheduleTerminalFit,
    requestTerminalFocus: () => focusTerminal({ explicit: false }),
  });
  if (!result.ok) return false;
  state.mode = result.mode;
  return true;
}

function setupPreviewNavigation() {
  previewNavigation.setup();
}

function zoomIn() {
  invoke("zoom_in").catch(() => {});
}

function zoomOut() {
  invoke("zoom_out").catch(() => {});
}

function resetZoom() {
  invoke("reset_zoom").catch(() => {});
}

function setupTerminal() {
  state.terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"SF Mono", "SFMono-Regular", "Symbols Nerd Font Mono", ui-monospace, monospace',
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 1.1,
    theme: {
      background: "#101214",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "#315d5f",
      black: "#101214",
      red: "#df5b61",
      green: "#78b892",
      yellow: "#c6a15b",
      blue: "#6791c9",
      magenta: "#bc83e3",
      cyan: "#67afc1",
      white: "#d8dee9",
      brightBlack: "#5b6268",
      brightRed: "#f16269",
      brightGreen: "#8fceaa",
      brightYellow: "#d5b26a",
      brightBlue: "#79a8e4",
      brightMagenta: "#d09bf1",
      brightCyan: "#7bc2d3",
      brightWhite: "#eceff4",
    },
  });
  state.terminal.attachCustomKeyEventHandler((event) => {
    if (shouldForwardRepeatedPrintableKey(event)) {
      event.preventDefault();
      sendNeovimInput(event.key);
      return false;
    }
    return true;
  });
  state.fit = new FitAddon();
  state.unicode = new Unicode11Addon();
  state.webgl = new WebglAddon();
  state.terminal.loadAddon(state.fit);
  state.terminal.loadAddon(state.unicode);
  state.terminal.unicode.activeVersion = "11";
  state.terminal.open(terminalHost);
  try {
    state.terminal.loadAddon(state.webgl);
    state.webgl.onContextLoss(() => {
      state.webgl.dispose();
      state.webgl = null;
    });
  } catch {
    state.webgl = null;
  }
  state.terminal.onData(sendNeovimInput);
  terminalPane.addEventListener("pointerdown", focusTerminal);
  terminalPane.addEventListener("click", focusTerminal);
  state.resizeObserver = new ResizeObserver(scheduleTerminalFit);
  state.resizeObserver.observe(terminalPane);
  state.resizeObserver.observe(terminalHost);
  window.addEventListener("resize", scheduleTerminalFit);
}

async function startTerminal() {
  fitTerminalNow();
  const { rows, cols } = state.terminal;
  await invoke("start_neovim", { root: state.root, rows, cols });
  await listen("nvim://data", (event) => state.terminal.write(event.payload));
  await listen("nvim://exit", () => state.terminal.writeln("\r\n[neovim exited]"));
  scheduleTerminalFit();
}

function scheduleTerminalFit(nextMode = state.mode) {
  if (!state.fit || nextMode === VIEW_MODES.MARKDOWN) return;
  if (state.fitFrame) cancelAnimationFrame(state.fitFrame);
  state.fitFrame = requestAnimationFrame(() => {
    state.fitFrame = null;
    fitTerminalNow();
    setTimeout(fitTerminalNow, 40);
    setTimeout(fitTerminalNow, 140);
  });
}

function fitTerminalNow() {
  if (!state.fit || state.mode === VIEW_MODES.MARKDOWN) return;
  if (terminalHost.clientWidth === 0 || terminalHost.clientHeight === 0) return;
  state.fit.fit();
  invoke("resize_neovim", {
    rows: state.terminal.rows,
    cols: state.terminal.cols,
  }).catch(() => {});
}

function focusTerminal({ explicit = false } = {}) {
  if (!state.terminal) return;
  if (!explicit && shouldBlockImplicitTerminalFocus(state.mode)) return;
  state.terminal.focus();
}

function sendNeovimInput(data) {
  invoke("write_to_neovim", { data }).catch((error) => {
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

async function loadMarkdown(path, tolerateMissing = false) {
  try {
    const file = await invoke("read_markdown", { root: state.root, path });
    previewRefresh.applyPreviewFile(file);
  } catch (error) {
    if (!tolerateMissing) throw error;
    markdownPreview.showEmpty();
    previewNavigation.syncButtons();
  }
}

async function activateMarkdownFile(path) {
  await invoke("open_markdown_in_neovim", { path });
}

function renderMath(source, displayMode) {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
}
