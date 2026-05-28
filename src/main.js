import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import katex from "katex";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const state = {
  root: "",
  currentPath: "README.md",
  currentContent: "",
  mode: "split",
  terminal: null,
  fit: null,
  resizeObserver: null,
  fitFrame: null,
  previewRefreshTimer: null,
  previewRefreshInFlight: false,
};

document.querySelector("#app").innerHTML = `
  <main class="shell" data-mode="split">
    <header class="topbar">
      <div class="brand">
        <span class="mark"></span>
        <div>
          <strong>Codomain</strong>
          <small id="rootLabel"></small>
        </div>
      </div>
      <div class="mode-switch" role="group" aria-label="View mode">
        <button data-mode-target="nvim" title="Neovim full view">NV</button>
        <button data-mode-target="split" title="Split view">SP</button>
        <button data-mode-target="markdown" title="Markdown full view">MD</button>
      </div>
    </header>
    <section class="workspace">
      <section class="pane pane-terminal" aria-label="Neovim">
        <div class="pane-header">
          <span>Neovim</span>
          <kbd>Ctrl+1</kbd>
        </div>
        <div id="terminal"></div>
      </section>
      <section class="pane pane-markdown" aria-label="Markdown preview">
        <div class="pane-header">
          <span id="fileLabel">Markdown</span>
          <kbd>Ctrl+3</kbd>
        </div>
        <article id="preview" class="preview"></article>
      </section>
    </section>
  </main>
`;

const rootLabel = document.querySelector("#rootLabel");
const fileLabel = document.querySelector("#fileLabel");
const preview = document.querySelector("#preview");
const shell = document.querySelector(".shell");
const terminalPane = document.querySelector(".pane-terminal");
const terminalHost = document.querySelector("#terminal");

boot().catch((error) => {
  preview.innerHTML = `<div class="empty-state"><h1>Codomain could not start</h1><p>${escapeHtml(String(error))}</p></div>`;
});

async function boot() {
  state.root = await invoke("initialize_root");
  rootLabel.textContent = state.root;
  setupModes();
  setupTerminal();
  await startTerminal();
  await loadMarkdown(state.currentPath, true);
  await listen("nvim://buffer-changed", schedulePreviewRefresh);
  focusTerminal();
  window.setInterval(refreshFromNeovim, 1000);
}

function setupModes() {
  document.querySelectorAll("[data-mode-target]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.modeTarget));
  });

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey) return;
    if (event.key === "1") {
      event.preventDefault();
      setMode("nvim");
    }
    if (event.key === "2") {
      event.preventDefault();
      setMode("split");
    }
    if (event.key === "3") {
      event.preventDefault();
      setMode("markdown");
    }
  });
}

function setMode(mode) {
  state.mode = mode;
  shell.dataset.mode = mode;
  document.querySelectorAll("[data-mode-target]").forEach((button) => {
    button.toggleAttribute("aria-pressed", button.dataset.modeTarget === mode);
  });
  scheduleTerminalFit();
  window.setTimeout(() => {
    if (mode !== "markdown") focusTerminal();
  }, 50);
}

function setupTerminal() {
  state.terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"Berkeley Mono", "SFMono-Regular", ui-monospace, monospace',
    fontSize: 13,
    lineHeight: 1.1,
    theme: {
      background: "#101214",
      foreground: "#e6e0d6",
      cursor: "#f4c95d",
      selectionBackground: "#315d5f",
      black: "#101214",
      red: "#df5b61",
      green: "#78b892",
      yellow: "#deba6f",
      blue: "#6791c9",
      magenta: "#bc83e3",
      cyan: "#67afc1",
      white: "#e6e0d6",
      brightBlack: "#5b6268",
      brightRed: "#f16269",
      brightGreen: "#8fceaa",
      brightYellow: "#eecb82",
      brightBlue: "#79a8e4",
      brightMagenta: "#d09bf1",
      brightCyan: "#7bc2d3",
      brightWhite: "#f7f3ee",
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
  state.terminal.loadAddon(state.fit);
  state.terminal.open(terminalHost);
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

function scheduleTerminalFit() {
  if (!state.fit || state.mode === "markdown") return;
  if (state.fitFrame) cancelAnimationFrame(state.fitFrame);
  state.fitFrame = requestAnimationFrame(() => {
    state.fitFrame = null;
    fitTerminalNow();
    setTimeout(fitTerminalNow, 40);
    setTimeout(fitTerminalNow, 140);
  });
}

function fitTerminalNow() {
  if (!state.fit || state.mode === "markdown") return;
  if (terminalHost.clientWidth === 0 || terminalHost.clientHeight === 0) return;
  state.fit.fit();
  invoke("resize_neovim", {
    rows: state.terminal.rows,
    cols: state.terminal.cols,
  }).catch(() => {});
}

function focusTerminal() {
  if (!state.terminal || state.mode === "markdown") return;
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
    renderFile(file);
  } catch (error) {
    if (!tolerateMissing) throw error;
    preview.innerHTML = `<div class="empty-state"><h1>No Markdown file selected</h1><p>Create or open a Markdown file in this workspace, then use Obsidian-style links from this pane.</p></div>`;
  }
}

async function refreshFromNeovim() {
  if (state.previewRefreshInFlight) return;
  state.previewRefreshInFlight = true;
  try {
    const file = await invoke("read_current_neovim_markdown");
    if (!file || (file.path === state.currentPath && file.content === state.currentContent)) return;
    renderFile(file);
  } catch {
    // Neovim can briefly reject remote calls while starting or exiting.
  } finally {
    state.previewRefreshInFlight = false;
  }
}

function schedulePreviewRefresh() {
  if (state.previewRefreshTimer) clearTimeout(state.previewRefreshTimer);
  state.previewRefreshTimer = setTimeout(() => {
    state.previewRefreshTimer = null;
    refreshFromNeovim();
  }, 80);
}

function bindPreviewLinks() {
  preview.querySelectorAll("[data-wikilink]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const target = link.dataset.wikilink;
      try {
        const file = await invoke("open_wikilink_in_neovim", {
          fromPath: state.currentPath,
          target,
        });
        renderFile(file);
        preview.scrollTop = 0;
      } catch (error) {
        showPreviewError(`Could not open [[${target}]]`, error);
      }
    });
  });
}

function renderFile(file) {
  state.currentPath = file.path;
  state.currentContent = file.content;
  fileLabel.textContent = file.path;
  preview.innerHTML = renderMarkdown(file.content);
  bindPreviewLinks();
}

function showPreviewError(title, error) {
  const message = document.createElement("div");
  message.className = "preview-error";
  message.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(String(error))}</span>`;
  preview.prepend(message);
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inList = false;
  let inCode = false;
  let inMath = false;
  let code = [];
  let math = [];

  for (const line of lines) {
    if (line.trim() === "$$") {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (inMath) {
        html.push(renderMathBlock(math.join("\n")));
        math = [];
      }
      inMath = !inMath;
      continue;
    }

    if (inMath) {
      math.push(line);
      continue;
    }

    const singleLineMath = line.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (singleLineMath) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(renderMathBlock(singleLineMath[1].trim()));
      continue;
    }

    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) html.push("<ul>");
      inList = true;
      html.push(`<li>${inlineMarkdown(listMatch[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      html.push(`<h${level}>${inlineMarkdown(line.slice(level).trim())}</h${level}>`);
    } else if (line.trim() === "") {
      html.push("");
    } else {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  if (inList) html.push("</ul>");
  if (inCode) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  if (inMath) html.push(renderMathBlock(math.join("\n")));
  return html.join("\n");
}

function inlineMarkdown(text) {
  const tokens = /(`[^`]+`|\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\$[^$\n]+\$)/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    html += escapeHtml(text.slice(cursor, match.index));
    html += renderInlineToken(match[0]);
    cursor = match.index + match[0].length;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

function renderInlineToken(token) {
  if (token.startsWith("`")) {
    return `<code>${escapeHtml(token.slice(1, -1))}</code>`;
  }

  if (token.startsWith("[[")) {
    const body = token.slice(2, -2);
    const [target, label] = body.split("|");
    return `<a href="#" data-wikilink="${escapeHtml(target)}">${escapeHtml(label || target)}</a>`;
  }

  if (token.startsWith("**")) {
    return `<strong>${inlineMarkdown(token.slice(2, -2))}</strong>`;
  }

  if (token.startsWith("$")) {
    return renderMath(token.slice(1, -1), false);
  }

  return escapeHtml(token);
}

function renderMathBlock(source) {
  return `<div class="math-block">${renderMath(source, true)}</div>`;
}

function renderMath(source, displayMode) {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
