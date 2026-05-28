import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownRendering } from "./markdownRendering.js";

function renderMath(source, displayMode) {
  return displayMode ? `<math-block>${source}</math-block>` : `<math-inline>${source}</math-inline>`;
}

test("renders headings lists fences math wikilinks and escaping with existing output", () => {
  const rendering = createMarkdownRendering({ renderMath });
  assert.equal(
    rendering.render(
      "# Title\n\n- one\n- **two**\n\n```js\nconst value = 1 < 2;\n```\n\nInline $x^2$.\n$$\ny = 1\n$$\n\nOpen [[Nested/Deep Note|deep note]] and [[Home]].",
    ),
    [
      "<h1>Title</h1>",
      "",
      "<ul>",
      "<li>one</li>",
      "<li><strong>two</strong></li>",
      "</ul>",
      "",
      "<pre><code>const value = 1 &lt; 2;</code></pre>",
      "",
      "<p>Inline <math-inline>x^2</math-inline>.</p>",
      "<div class=\"math-block\"><math-block>y = 1</math-block></div>",
      "",
      '<p>Open <a href="#" data-wikilink="Nested/Deep Note">deep note</a> and <a href="#" data-wikilink="Home">Home</a>.</p>',
    ].join("\n"),
  );
});
