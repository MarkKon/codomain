import MarkdownIt from "markdown-it";
import { installMathExtension } from "./markdownRendering/extensions/mathExtension.js";
import { createPipeSentinel, protectWikilinkPipes } from "./markdownRendering/extensions/pipeSentinel.js";
import { installWikilinkExtension } from "./markdownRendering/extensions/wikilinkExtension.js";

const SOURCE_LINE_ATTRIBUTE = "data-source-line";
const SOURCE_LINE_END_ATTRIBUTE = "data-source-line-end";

export function createMarkdownRendering({ renderMath }) {
  let activePipeSentinel = null;
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
  });
  installMathExtension(markdown, renderMath);
  installWikilinkExtension(markdown, () => activePipeSentinel);
  installSourceLineMetadata(markdown);

  const baseBlockMathRenderer = markdown.renderer.rules.codomain_math_block;
  markdown.renderer.rules.codomain_math_block = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const rendered = baseBlockMathRenderer ? baseBlockMathRenderer(tokens, idx, options, env, self) : "";
    return injectTokenSourceLineMetadataIntoFirstTag(rendered, token);
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

export function getSourceLineSpanFromTokenMap(tokenMap) {
  if (!Array.isArray(tokenMap) || tokenMap.length < 2) return null;
  const [startLineZeroBased, endLineExclusiveZeroBased] = tokenMap;
  if (!Number.isInteger(startLineZeroBased) || !Number.isInteger(endLineExclusiveZeroBased)) return null;
  if (endLineExclusiveZeroBased <= startLineZeroBased) return null;
  return {
    startLine: startLineZeroBased + 1,
    endLine: endLineExclusiveZeroBased,
  };
}

function installSourceLineMetadata(markdown) {
  markdown.core.ruler.push("codomain_source_line_metadata", (state) => {
    for (const token of state.tokens) {
      if (!isSourceLineMappableBlockToken(token)) continue;
      const span = getSourceLineSpanFromTokenMap(token.map);
      if (!span) continue;
      token.attrSet(SOURCE_LINE_ATTRIBUTE, String(span.startLine));
      if (span.endLine > span.startLine) {
        token.attrSet(SOURCE_LINE_END_ATTRIBUTE, String(span.endLine));
      }
    }
  });
}

function isSourceLineMappableBlockToken(token) {
  return Boolean(token && token.block && token.tag && token.nesting !== -1 && token.map);
}

function injectTokenSourceLineMetadataIntoFirstTag(rendered, token) {
  if (!rendered) return rendered;
  const start = token.attrGet(SOURCE_LINE_ATTRIBUTE);
  if (!start) return rendered;
  const end = token.attrGet(SOURCE_LINE_END_ATTRIBUTE);
  const serializedAttrs = end
    ? ` ${SOURCE_LINE_ATTRIBUTE}="${escapeAttribute(start)}" ${SOURCE_LINE_END_ATTRIBUTE}="${escapeAttribute(end)}"`
    : ` ${SOURCE_LINE_ATTRIBUTE}="${escapeAttribute(start)}"`;
  return rendered.replace(
    /<([A-Za-z][^\s/>]*)([^>]*)>/,
    (_fullMatch, tagName, existingAttrs) => `<${tagName}${existingAttrs}${serializedAttrs}>`,
  );
}

function escapeAttribute(value) {
  return String(value).replace(/"/g, "&quot;");
}
