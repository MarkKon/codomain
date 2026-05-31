import { escapeHtml } from "./markdownEscaping.js";
import { createMarkdownRendering } from "./markdownRendering.js";
import { findNearestSourceLineBlock, maybeGetScrollTopForLine } from "./previewSourceLines.js";

export function createMarkdownPreview({
  host,
  renderMath,
  openWikilink,
  onPathTransition,
  moveCursorToSourceLine,
}) {
  const markdownRendering = createMarkdownRendering({ renderMath });
  let displayedFile = null;
  let lastFollowedCursor = null;
  let suppressedFollowTarget = null;

  bindPreviewJump();

  function reset() {
    displayedFile = null;
    lastFollowedCursor = null;
    suppressedFollowTarget = null;
    host.innerHTML = "";
  }

  function isDisplaying(file) {
    return (
      displayedFile &&
      file &&
      displayedFile.path === file.path &&
      displayedFile.content === file.content
    );
  }

  function currentPath() {
    return displayedFile?.path ?? null;
  }

  function renderFile(file, options = {}) {
    if (isDisplaying(file)) return false;
    displayedFile = { path: file.path, content: file.content };
    lastFollowedCursor = null;
    suppressedFollowTarget = null;
    host.innerHTML = markdownRendering.render(file.content);
    bindWikilinks();
    if (options.scrollToTop) host.scrollTop = 0;
    return true;
  }

  function showEmpty() {
    displayedFile = null;
    lastFollowedCursor = null;
    suppressedFollowTarget = null;
    host.innerHTML = `<div class="empty-state"><h1>No Markdown file selected</h1><p>Create or open a Markdown file in this workspace, then use Obsidian-style links from this pane.</p></div>`;
  }

  function showError(title, error) {
    const message = document.createElement("div");
    message.className = "preview-error";
    message.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(String(error))}</span>`;
    host.prepend(message);
  }

  function bindWikilinks() {
    host.querySelectorAll("[data-wikilink]").forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        const target = link.dataset.wikilink;
        try {
          const previousFile = displayedFile ? { ...displayedFile } : null;
          const previousPath = previousFile?.path ?? null;
          const file = await openWikilink({
            fromPath: displayedFile?.path || "",
            target,
          });
          const didRender = renderFile(file, { scrollToTop: true });
          if (didRender && previousPath !== file.path) {
            onPathTransition?.(previousPath, file.path, { previousFile, nextFile: file });
          }
        } catch (error) {
          showError(`Could not open [[${target}]]`, error);
        }
      });
    });
  }

  function followCursorLine({ path, line } = {}) {
    if (!displayedFile || typeof path !== "string" || !Number.isInteger(line) || line < 1) return false;
    if (displayedFile.path !== path) return false;
    if (suppressedFollowTarget && suppressedFollowTarget.path === path && suppressedFollowTarget.line === line) {
      suppressedFollowTarget = null;
      lastFollowedCursor = { path, line };
      return false;
    }
    if (lastFollowedCursor && lastFollowedCursor.path === path && lastFollowedCursor.line === line) return false;

    lastFollowedCursor = { path, line };
    const nextScrollTop = maybeGetScrollTopForLine({ host, line });
    if (nextScrollTop == null || nextScrollTop === host.scrollTop) return false;
    host.scrollTop = nextScrollTop;
    return true;
  }

  function bindPreviewJump() {
    if (typeof host?.addEventListener !== "function") return;
    host.addEventListener("dblclick", async (event) => {
      if (!displayedFile?.path || typeof moveCursorToSourceLine !== "function") return;
      const block = findNearestSourceLineBlock({
        host,
        target: event.target,
        clientY: event.clientY,
      });
      if (!block) return;
      suppressedFollowTarget = { path: displayedFile.path, line: block.startLine };
      try {
        await moveCursorToSourceLine(displayedFile.path, block.startLine);
      } catch (error) {
        showError(`Could not move cursor to line ${block.startLine}`, error);
      }
    });
  }

  return {
    reset,
    renderFile,
    showEmpty,
    showError,
    isDisplaying,
    currentPath,
    currentFile: () => (displayedFile ? { ...displayedFile } : null),
    followCursorLine,
  };
}
