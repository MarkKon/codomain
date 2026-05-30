import { isAlphaNumeric, isEscapedByOddBackslashes } from "../shared/mathParsing.js";

export function installMathExtension(markdown, renderMath) {
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
