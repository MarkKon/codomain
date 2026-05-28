export function createMarkdownPreview({ host, renderMath, openWikilink, onPathTransition }) {
  const renderMarkdown = createMarkdownRenderer(renderMath);
  let displayedFile = null;
  let backStack = [];
  let forwardStack = [];

  function reset() {
    displayedFile = null;
    backStack = [];
    forwardStack = [];
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
    if (
      options.recordHistory !== false &&
      displayedFile &&
      displayedFile.path !== file.path
    ) {
      backStack.push(displayedFile);
      forwardStack = [];
    }
    displayedFile = { path: file.path, content: file.content };
    host.innerHTML = renderMarkdown(file.content);
    bindWikilinks();
    if (options.scrollToTop) host.scrollTop = 0;
    return true;
  }

  function canGoBack() {
    return backStack.length > 0;
  }

  function canGoForward() {
    return forwardStack.length > 0;
  }

  function goBack() {
    if (!canGoBack()) return null;
    if (displayedFile) forwardStack.push(displayedFile);
    const next = backStack.pop();
    renderFile(next, { recordHistory: false, scrollToTop: true });
    return next;
  }

  function goForward() {
    if (!canGoForward()) return null;
    if (displayedFile) backStack.push(displayedFile);
    const next = forwardStack.pop();
    renderFile(next, { recordHistory: false, scrollToTop: true });
    return next;
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
          const previousPath = displayedFile?.path ?? null;
          const file = await openWikilink({
            fromPath: displayedFile?.path || "",
            target,
          });
          const didRender = renderFile(file, { scrollToTop: true });
          if (didRender && previousPath !== file.path) {
            onPathTransition?.(previousPath, file.path);
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
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    currentPath,
  };
}

export function createMarkdownRenderer(renderMath) {
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

  return renderMarkdown;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
