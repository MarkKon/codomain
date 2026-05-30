import MarkdownIt from "markdown-it";
import { installMathExtension } from "./markdownRendering/extensions/mathExtension.js";
import { createPipeSentinel, protectWikilinkPipes } from "./markdownRendering/extensions/pipeSentinel.js";
import { installWikilinkExtension } from "./markdownRendering/extensions/wikilinkExtension.js";

export function createMarkdownRendering({ renderMath }) {
  let activePipeSentinel = null;
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
  });
  installMathExtension(markdown, renderMath);
  installWikilinkExtension(markdown, () => activePipeSentinel);

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
