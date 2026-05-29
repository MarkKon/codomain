import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownRendering } from "./markdownRendering.js";

function renderMath(source, displayMode) {
  return displayMode ? `<math-block>${source}</math-block>` : `<math-inline>${source}</math-inline>`;
}

test("renders markdown semantics including nested lists and fenced code escaping", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("# Title\n\n- one\n  - two\n\n```js\nconst value = 1 < 2;\n```");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>one[\s\S]*<ul>[\s\S]*<li>two<\/li>/);
  assert.match(html, /<pre><code class="language-js">const value = 1 &lt; 2;\n<\/code><\/pre>/);
});

test("preserves wikilinks with label support and escaped attributes and labels", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("Open [[A&B|<Label>]] and [[Home]] and [[Home|]].");
  assert.match(html, /<a href="#" data-wikilink="A&amp;B">&lt;Label&gt;<\/a>/);
  assert.match(html, /<a href="#" data-wikilink="Home">Home<\/a>/);
  assert.match(html, /<a href="#" data-wikilink="Home">Home<\/a>/);
});

test("delegates inline and block math rendering through renderMath", () => {
  const rendering = createMarkdownRendering({ renderMath });
  assert.equal(
    rendering.render("Inline $x^2$.\n$$\ny = 1\n$$\n$$z$$"),
    "<p>Inline <math-inline>x^2</math-inline>.</p>\n<div class=\"math-block\"><math-block>y = 1</math-block></div>\n<div class=\"math-block\"><math-block>z</math-block></div>",
  );
});

test("supports inline math containing whitespace and punctuation", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("Compute $x + y$ and $f(x, y)$.");
  assert.match(html, /<math-inline>x \+ y<\/math-inline>/);
  assert.match(html, /<math-inline>f\(x, y\)<\/math-inline>/);
});

test("does not expand wikilinks or math inside inline code and fences", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("`$x$ [[Home]]`\n\n```md\n[[Home]] $x$\n```");
  assert.match(html, /<code>\$x\$ \[\[Home\]\]<\/code>/);
  assert.match(html, /<pre><code class="language-md">\[\[Home\]\] \$x\$\n<\/code><\/pre>/);
  assert.equal(html.includes("data-wikilink"), false);
  assert.equal(html.includes("<math-inline>"), false);
});

test("does not autolink bare urls but still renders markdown links", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("Visit http://example.com and [Example](http://example.com).");
  assert.match(html, /Visit http:\/\/example\.com and <a href="http:\/\/example\.com">Example<\/a>\./);
  assert.equal(html.includes('href="http://example.com">http://example.com</a>'), false);
});

test("renders block math within list items and blockquotes", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("- item\n  $$\n  x\n  $$\n\n> $$\n> y\n> $$");
  assert.match(html, /<li>item[\s\S]*<div class="math-block"><math-block>x<\/math-block><\/div>[\s\S]*<\/li>/);
  assert.match(html, /<blockquote>[\s\S]*<div class="math-block"><math-block>y<\/math-block><\/div>[\s\S]*<\/blockquote>/);
});

test("does not parse inline math from double-dollar delimiters in prose", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("foo $$z$$ bar");
  assert.equal(html.includes("<math-inline>"), false);
  assert.match(html, /<p>foo \$\$z\$\$ bar<\/p>/);
});

test("does not corrupt prose around escaped dollar delimiters", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("\\$x$ and $y$");
  assert.equal(html.includes("<math-inline> and </math-inline>"), false);
  assert.match(html, /<p>\$x\$ and (?:\$y\$|<math-inline>y<\/math-inline>)<\/p>/);
});
