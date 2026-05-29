import MarkdownIt from "markdown-it";
import { escapeHtml } from "./markdownEscaping.js";

export function createMarkdownRendering({ renderMath }) {
  let activePipeSentinel = null;
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
  });
  installMathRules(markdown, renderMath);

  markdown.core.ruler.after("inline", "codomain_wikilink", (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) continue;
      blockToken.children = expandWikilinks(blockToken.children, state.Token, activePipeSentinel);
    }
  });

  markdown.renderer.rules.codomain_wikilink = (tokens, idx) => {
    const target = tokens[idx].meta.target;
    const label = tokens[idx].meta.label || target;
    return `<a href="#" data-wikilink="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
  };
  markdown.renderer.rules.codomain_embed_image = (tokens, idx) => {
    const src = tokens[idx].meta.src;
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(src)}">`;
  };

  function render(source) {
    const normalized = source.replace(/\r\n/g, "\n");
    const sentinel = createPipeSentinel(normalized);
    activePipeSentinel = sentinel;
    const rendered = markdown.render(protectWikilinkPipes(normalized, sentinel));
    activePipeSentinel = null;
    return rendered.replaceAll(sentinel, "|").trim();
  }

  return { render };
}

function installMathRules(markdown, renderMath) {
  markdown.inline.ruler.before("escape", "codomain_inline_math", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x24) return false;
    if (isEscapedByOddBackslashes(src, start)) return false;
    if (start + 1 < src.length && src.charCodeAt(start + 1) === 0x24) return false;
    if (start > 0 && src.charCodeAt(start - 1) === 0x24) return false;
    if (isAlphaNumeric(src.charCodeAt(start - 1))) return false;

    let end = start + 1;
    while (end < src.length) {
      if (src.charCodeAt(end) === 0x0a) return false;
      if (src.charCodeAt(end) === 0x24 && !isEscapedByOddBackslashes(src, end)) break;
      end += 1;
    }
    if (end >= src.length || end === start + 1) return false;
    if (isAlphaNumeric(src.charCodeAt(end + 1))) return false;
    if (!silent) {
      const token = state.push("codomain_math_inline", "math", 0);
      token.content = src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });

  markdown.block.ruler.before(
    "fence",
    "codomain_block_math",
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (start + 2 > max) return false;
      const firstLine = state.src.slice(start, max);
      const trimmedFirstLine = firstLine.trimEnd();
      if (!trimmedFirstLine.startsWith("$$")) return false;
      if (trimmedFirstLine.length > 4 && trimmedFirstLine.endsWith("$$")) {
        if (!silent) {
          const token = state.push("codomain_math_block", "math", 0);
          token.block = true;
          token.content = trimmedFirstLine.slice(2, -2);
        }
        state.line = startLine + 1;
        return true;
      }
      if (trimmedFirstLine !== "$$") return false;

      let nextLine = startLine + 1;
      while (nextLine < endLine) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineEnd = state.eMarks[nextLine];
        if (state.src.slice(lineStart, lineEnd).trimEnd() === "$$") {
          if (!silent) {
            const token = state.push("codomain_math_block", "math", 0);
            token.block = true;
            token.content = stripMathIndentation(
              state.getLines(startLine + 1, nextLine, 0, false).replace(/\n$/, ""),
              state.tShift[startLine],
            );
          }
          state.line = nextLine + 1;
          return true;
        }
        nextLine += 1;
      }
      return false;
    },
    {
      alt: ["paragraph", "reference", "blockquote", "list"],
    },
  );

  markdown.renderer.rules.codomain_math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
  markdown.renderer.rules.codomain_math_block = (tokens, idx) => `${renderMath(tokens[idx].content, true)}\n`;
}

function stripMathIndentation(content, baseIndent) {
  const baseTrimmed = content
    .split("\n")
    .map((line) => trimLeadingSpaces(line, baseIndent))
    .join("\n");

  const lines = baseTrimmed.split("\n");
  let commonIndent = null;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let indent = 0;
    while (indent < line.length && line.charCodeAt(indent) === 0x20) indent += 1;
    commonIndent = commonIndent === null ? indent : Math.min(commonIndent, indent);
  }
  if (!commonIndent) return baseTrimmed;
  return lines
    .map((line) => (line.trim().length === 0 ? line : line.slice(commonIndent)))
    .join("\n");
}

function trimLeadingSpaces(text, maxSpaces) {
  let i = 0;
  while (i < text.length && i < maxSpaces && text.charCodeAt(i) === 0x20) i += 1;
  return text.slice(i);
}

function isAlphaNumeric(code) {
  if (typeof code !== "number") return false;
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

function expandWikilinks(children, Token, sentinel) {
  const transformed = [];
  let linkDepth = 0;

  for (const child of children) {
    if (child.type === "link_open") {
      linkDepth += 1;
      transformed.push(child);
      continue;
    }
    if (child.type === "link_close") {
      linkDepth = Math.max(0, linkDepth - 1);
      transformed.push(child);
      continue;
    }
    if (child.type === "image" || linkDepth > 0 || child.type !== "text") {
      transformed.push(child);
      continue;
    }

    const parts = splitTextByEmbedsAndWikilinks(child.content, sentinel);
    if (parts.length === 1 && parts[0].type === "text") {
      transformed.push(child);
      continue;
    }

    for (const part of parts) {
      if (part.type === "text") {
        const token = new Token("text", "", 0);
        token.content = part.content;
        transformed.push(token);
      } else if (part.type === "wikilink") {
        const token = new Token("codomain_wikilink", "", 0);
        token.meta = { target: part.target, label: part.label };
        transformed.push(token);
      } else {
        const token = new Token("codomain_embed_image", "img", 0);
        token.meta = { src: part.target };
        transformed.push(token);
      }
    }
  }

  return transformed;
}

function splitTextByEmbedsAndWikilinks(content, sentinel) {
  const parts = [];
  const pattern = /(!)?\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match = pattern.exec(content);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    const body = match[2];
    const sep = sentinel ? body.indexOf(sentinel) : -1;
    if (match[1] === "!") {
      if (sep >= 0) {
        parts.push({ type: "text", content: match[0] });
      } else {
        parts.push({ type: "embed_image", target: body });
      }
    } else if (sep >= 0) {
      parts.push({ type: "wikilink", target: body.slice(0, sep), label: body.slice(sep + sentinel.length) });
    } else {
      parts.push({ type: "wikilink", target: body });
    }
    lastIndex = pattern.lastIndex;
    match = pattern.exec(content);
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", content }];
}

function protectWikilinkPipes(source, sentinel) {
  return source.replace(/\[\[[\s\S]*?\]\]/g, (token) => token.replaceAll("|", sentinel));
}

function createPipeSentinel(source) {
  let nonce = 0;
  let candidate = "CDWIKIPIPE0TOKEN";
  while (source.includes(candidate)) {
    nonce += 1;
    candidate = `CDWIKIPIPE${nonce}TOKEN`;
  }
  return candidate;
}

function isEscapedByOddBackslashes(src, index) {
  let count = 0;
  let i = index - 1;
  while (i >= 0 && src.charCodeAt(i) === 0x5c) {
    count += 1;
    i -= 1;
  }
  return count % 2 === 1;
}
