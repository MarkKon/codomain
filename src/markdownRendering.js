import { escapeHtml } from "./markdownEscaping.js";

export function createMarkdownRendering({ renderMath }) {
  function render(markdown) {
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

  return { render };
}
