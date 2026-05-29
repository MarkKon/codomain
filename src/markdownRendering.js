import MarkdownIt from "markdown-it";
import { escapeHtml } from "./markdownEscaping.js";

export function createMarkdownRendering({ renderMath }) {
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
  });

  markdown.inline.ruler.before("escape", "codomain_inline_math", inlineMathRule);
  markdown.inline.ruler.before("escape", "codomain_wikilink", wikilinkRule);
  markdown.block.ruler.before("blockquote", "codomain_math_block", mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  markdown.renderer.rules.codomain_inline_math = (tokens, idx) => renderMath(tokens[idx].content, false);
  markdown.renderer.rules.codomain_wikilink = (tokens, idx) => {
    const target = tokens[idx].meta.target;
    const label = tokens[idx].meta.label || target;
    return `<a href="#" data-wikilink="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
  };
  markdown.renderer.rules.codomain_math_block = (tokens, idx) => {
    return `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>\n`;
  };

  function render(source) {
    return markdown.render(source.replace(/\r\n/g, "\n")).trim();
  }

  return { render };
}

function inlineMathRule(state, silent) {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24) return false;
  if (isEscaped(state.src, start)) return false;
  if (start > 0 && state.src.charCodeAt(start - 1) === 0x24) return false;
  if (isAlphaNumeric(state.src.charCodeAt(start - 1))) return false;
  if (state.src.charCodeAt(start + 1) === 0x24) return false;
  let end = start + 1;
  while (end < state.src.length) {
    if (state.src.charCodeAt(end) === 0x24 && !isEscaped(state.src, end)) break;
    if (state.src.charCodeAt(end) === 0x0a) return false;
    end += 1;
  }
  if (end >= state.src.length || end <= start + 1) return false;
  if (state.src.charCodeAt(end - 1) === 0x24) return false;
  if (state.src.charCodeAt(end + 1) === 0x24) return false;
  if (isAlphaNumeric(state.src.charCodeAt(end + 1))) return false;
  const content = state.src.slice(start + 1, end);
  if (!silent) {
    const token = state.push("codomain_inline_math", "", 0);
    token.content = content;
  }
  state.pos = end + 1;
  return true;
}

function isEscaped(source, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && source.charCodeAt(i) === 0x5c; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isAlphaNumeric(code) {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function wikilinkRule(state, silent) {
  const start = state.pos;
  if (state.src.slice(start, start + 2) !== "[[") return false;
  const end = state.src.indexOf("]]", start + 2);
  if (end < 0) return false;
  const body = state.src.slice(start + 2, end);
  const [targetRaw, labelRaw] = body.split("|");
  if (!targetRaw) return false;
  if (!silent) {
    const token = state.push("codomain_wikilink", "", 0);
    token.meta = { target: targetRaw, label: labelRaw };
  }
  state.pos = end + 2;
  return true;
}

function mathBlockRule(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== "$$") return false;

  const firstLine = state.src.slice(pos + 2, max).trim();
  if (firstLine.endsWith("$$")) {
    if (silent) return true;
    const token = state.push("codomain_math_block", "", 0);
    token.block = true;
    token.content = firstLine.slice(0, -2).trim();
    state.line = startLine + 1;
    return true;
  }

  let nextLine = startLine + 1;
  let content = "";
  while (nextLine < endLine) {
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];
    const line = state.src.slice(pos, max);
    if (line.trim() === "$$") {
      if (silent) return true;
      const token = state.push("codomain_math_block", "", 0);
      token.block = true;
      token.content = content;
      state.line = nextLine + 1;
      return true;
    }
    content += (content ? "\n" : "") + line;
    nextLine += 1;
  }
  return false;
}
