import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import katex from "katex";
import { createAppShellRuntime } from "./appShellRuntime.js";
import { escapeHtml } from "./markdownEscaping.js";
import { createMarkdownWorkspace } from "./markdownWorkspace.js";
import { createMarkdownPreview } from "./markdownPreview.js";
import { createPreviewNavigationController } from "./previewNavigation.js";
import { createPreviewRefreshController, wirePreviewRefresh } from "./previewRefresh.js";
import { createTerminalRuntime } from "./terminalRuntime.js";
import { createViewModeRuntime, shouldBlockImplicitTerminalFocus } from "./viewModeRuntime.js";
import { VIEW_MODES } from "./viewModes.js";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const state = {
  root: "",
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
const modeButtons = document.querySelectorAll("[data-mode-target]");
const markdownPreview = createMarkdownPreview({
  host: preview,
  renderMath,
  openWikilink: ({ fromPath, target }) =>
    invoke("open_wikilink_in_neovim", { fromPath, target }),
  openExternalLink: (url) => invoke("open_external_link", { url }),
  moveCursorToSourceLine: (path, line) => invoke("move_neovim_cursor_to_markdown_line", { path, line }),
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
  focusTerminal: (...args) => terminalRuntime.focusTerminal(...args),
  activateMarkdownFile: (...args) => markdownWorkspace.activateMarkdownFile(...args),
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
const markdownWorkspace = createMarkdownWorkspace({
  getRoot: () => state.root,
  readMarkdown: ({ root, path }) => invoke("read_markdown", { root, path }),
  applyPreviewFile: (file) => previewRefresh.applyPreviewFile(file),
  showPreviewEmpty: () => markdownPreview.showEmpty(),
  syncPreviewNavigationButtons: () => previewNavigation.syncButtons(),
  openMarkdownInNeovim: ({ path }) => invoke("open_markdown_in_neovim", { path }),
});
const terminalRuntime = createTerminalRuntime({
  terminalHost,
  terminalPane,
  listenToEvent: listen,
  shouldBlockImplicitTerminalFocus,
  invokeStartNeovim: ({ root, rows, cols }) => invoke("start_neovim", { root, rows, cols }),
  invokeResizeNeovim: ({ rows, cols }) => invoke("resize_neovim", { rows, cols }),
  invokeWriteToNeovim: ({ data }) => invoke("write_to_neovim", { data }),
  createTerminal: () =>
    new Terminal({
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
    }),
  createFitAddon: () => new FitAddon(),
  createUnicodeAddon: () => new Unicode11Addon(),
  createWebglAddon: () => new WebglAddon(),
});
const viewModeRuntime = createViewModeRuntime({
  initialMode: VIEW_MODES.SPLIT,
  shell,
  getModeButtons: () => modeButtons,
  scheduleTerminalFit: (mode) => terminalRuntime.scheduleTerminalFit(mode),
  requestTerminalFocus: () => terminalRuntime.focusTerminal({ explicit: false }),
  zoomIn: () => invoke("zoom_in").catch(() => {}),
  zoomOut: () => invoke("zoom_out").catch(() => {}),
  resetZoom: () => invoke("reset_zoom").catch(() => {}),
  onModeChanged: (mode) => terminalRuntime.setMode(mode),
});
const appShellRuntime = createAppShellRuntime({
  initializeRoot: () => invoke("initialize_root"),
  onRootInitialized: (root) => {
    state.root = root;
    rootLabel.textContent = root;
  },
  setupModes: () => viewModeRuntime.setupModes(),
  setupPreviewNavigation,
  setupTerminal: () => terminalRuntime.setupTerminal(),
  startTerminal: () => terminalRuntime.startTerminal(state.root),
  loadReadmeMarkdown: (tolerateMissing) => markdownWorkspace.loadMarkdown("README.md", tolerateMissing),
  wirePreviewRefresh: () =>
    wirePreviewRefresh({
      listenToEvent: listen,
      setIntervalFn: window.setInterval.bind(window),
      previewRefresh,
    }),
  listenForModeChanges: () =>
    listen("codomain://set-mode", (event) => viewModeRuntime.setMode(event.payload)),
  focusTerminal: (...args) => terminalRuntime.focusTerminal(...args),
  stopNeovim: () => invoke("stop_neovim"),
  onRootChanged: (root) => {
    state.root = root;
    rootLabel.textContent = root;
  },
  resetMarkdownPreview: () => markdownPreview.reset(),
  resetPreviewNavigation: () => previewNavigation.resetHistoryState(),
  resetTerminal: () => terminalRuntime.state.terminal.reset(),
  fitTerminalNow: () => terminalRuntime.fitTerminalNow(),
  getTerminalDimensions: () => ({
    rows: terminalRuntime.state.terminal.rows,
    cols: terminalRuntime.state.terminal.cols,
  }),
  startNeovim: ({ root, rows, cols }) => invoke("start_neovim", { root, rows, cols }),
  scheduleTerminalFit: () => terminalRuntime.scheduleTerminalFit(),
});

boot().catch((error) => {
  preview.innerHTML = `<div class="empty-state"><h1>Codomain could not start</h1><p>${escapeHtml(String(error))}</p></div>`;
});

async function boot() {
  rootLabel.addEventListener("click", chooseRootFolder);
  await appShellRuntime.boot();
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
  await appShellRuntime.changeRoot(root);
}

function setupPreviewNavigation() {
  previewNavigation.setup();
}

function renderMath(source, displayMode) {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
}
