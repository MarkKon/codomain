import { escapeHtml } from "./markdownEscaping.js";
import { createMarkdownRendering } from "./markdownRendering.js";

export function createMarkdownPreview({ host, renderMath, openWikilink, onPathTransition }) {
  const markdownRendering = createMarkdownRendering({ renderMath });
  let displayedFile = null;

  function reset() {
    displayedFile = null;
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
    host.innerHTML = markdownRendering.render(file.content);
    bindWikilinks();
    if (options.scrollToTop) host.scrollTop = 0;
    return true;
  }

  function showEmpty() {
    displayedFile = null;
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

  return {
    reset,
    renderFile,
    showEmpty,
    showError,
    isDisplaying,
    currentPath,
    currentFile: () => (displayedFile ? { ...displayedFile } : null),
  };
}
