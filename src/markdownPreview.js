import { escapeHtml } from "./markdownEscaping.js";
import { createMarkdownRendering } from "./markdownRendering.js";
import { findNearestSourceLineBlock, maybeGetScrollTopForLine } from "./previewSourceLines.js";

export function createMarkdownPreview({
  host,
  renderMath,
  openWikilink,
  openExternalLink,
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
    bindExternalLinks();
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

  function bindExternalLinks() {
    if (typeof openExternalLink !== "function") return;
    host.querySelectorAll("a[href]:not([data-wikilink])").forEach((link) => {
      link.addEventListener("click", async (event) => {
        const href = link.getAttribute("href");
        if (!isExternalHref(href)) return;
        event.preventDefault();
        try {
          await openExternalLink(href);
        } catch (error) {
          showError(`Could not open ${href}`, error);
        }
      });
    });
  }

  function followCursorLine({ path, line } = {}) {
    if (!displayedFile || typeof path !== "string" || !Number.isInteger(line) || line < 1) return false;
    if (displayedFile.path !== path) return false;
    if (suppressedFollowTarget && suppressedFollowTarget.path === path) {
      if (suppressedFollowTarget.line === line) {
        suppressedFollowTarget = null;
        lastFollowedCursor = { path, line };
      }
      return false;
    }
    if (lastFollowedCursor && lastFollowedCursor.path === path && lastFollowedCursor.line === line) return false;

    lastFollowedCursor = { path, line };
    const nextScrollTop = maybeGetScrollTopForLine({ host, line });
    if (nextScrollTop == null || nextScrollTop === host.scrollTop) return false;
    scrollPreviewTo(host, nextScrollTop, { smooth: true });
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
        suppressedFollowTarget = null;
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

function isExternalHref(href) {
  if (typeof href !== "string") return false;
  return /^(https?|mailto):/i.test(href.trim());
}

function scrollPreviewTo(host, top, { smooth = false } = {}) {
  if (!Number.isFinite(top)) return;
  if (smooth && typeof host?.scrollTo === "function" && !prefersReducedMotion()) {
    host.scrollTo({ top, behavior: "smooth" });
    return;
  }
  host.scrollTop = top;
}

function prefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}
