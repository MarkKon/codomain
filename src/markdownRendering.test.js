import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownRendering } from "./markdownRendering.js";

function renderMath(source, displayMode) {
  return displayMode ? `<math-display>${source}</math-display>` : `<math-inline>${source}</math-inline>`;
}

test("renders markdown semantics including nested lists and fenced code escaping", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("# Title\n\n- one\n  - two\n\n```js\nconst value = 1 < 2;\n```");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>one[\s\S]*<ul>[\s\S]*<li>two<\/li>/);
  assert.match(html, /<pre><code class="language-js">const value = 1 &lt; 2;\n<\/code><\/pre>/);
});

test("renders standard markdown images, tables, and links via markdown-it", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render(
    "![Alt](./image.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Example](https://example.com)",
  );
  assert.match(html, /<img src="\.\/image\.png" alt="Alt">/);
  assert.match(html, /<table>/);
  assert.match(html, /<td>1<\/td>/);
  assert.match(html, /<a href="https:\/\/example\.com">Example<\/a>/);
});

test("does not break image alt text parsing when alt contains wikilink syntax", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("![alt [[Home]]](./image.png)");
  assert.match(html, /<img src="\.\/image\.png" alt="alt \[\[Home\]\]">/);
});

test("does not break image alt text parsing when alt contains labeled wikilink syntax", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("![alt [[Home|Label]]](./image.png)");
  assert.match(html, /<img src="\.\/image\.png" alt="alt \[\[Home\|Label\]\]">/);
});

test("does not break markdown links when link label contains wikilink syntax", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("[text [[Home]]](https://example.com)");
  assert.match(html, /<a href="https:\/\/example\.com">text \[\[Home\]\]<\/a>/);
});

test("preserves wikilinks with label support and escaped attributes and labels", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("Open [[A&B|<Label>]] and [[Home]] and [[Home|]].");
  assert.match(html, /<a href="#" data-wikilink="A&amp;B">&lt;Label&gt;<\/a>/);
  assert.match(html, /<a href="#" data-wikilink="Home">Home<\/a>/);
  assert.match(html, /<a href="#" data-wikilink="Home">Home<\/a>/);
});

test("renders wikilink when table cell contains only wikilink syntax", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("| Ref |\n| - |\n| [[Home]] |");
  assert.match(html, /<td><a href="#" data-wikilink="Home">Home<\/a><\/td>/);
});

test("renders labeled wikilink inside markdown table cell", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("| Ref |\n| - |\n| [[Home|Label]] |");
  assert.match(html, /<td><a href="#" data-wikilink="Home">Label<\/a><\/td>/);
});

test("renders inline math including spaces", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("Inline $ x^2 + 1 $ text.");
  assert.equal(html, "<p>Inline <math-inline> x^2 + 1 </math-inline> text.</p>");
});

test("renders single-line display math", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("$$\ny = x + 1\n$$");
  assert.equal(html, "<math-display>y = x + 1</math-display>");
});

test("renders same-line display math with double-dollar delimiters", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("$$z$$");
  assert.equal(html, "<math-display>z</math-display>");
});

test("renders same-line display math with trailing whitespace", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("$$z$$   ");
  assert.equal(html, "<math-display>z</math-display>");
});

test("renders multiline display math", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("$$\na = 1\nb = 2\n$$");
  assert.equal(html, "<math-display>a = 1\nb = 2</math-display>");
});

test("renders multiline display math with trailing spaces on closing delimiter", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("$$\n x\n$$   ");
  assert.equal(html, "<math-display>x</math-display>");
});

test("renders display math inside list items with indentation", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("- item\n\n  $$\n  x\n  $$");
  assert.match(html, /<li>\s*<p>item<\/p>\s*<math-display>x<\/math-display>\s*<\/li>/);
});

test("normalizes multiline display math indentation inside nested list context", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("- item\n\n  $$\n    x\n  $$");
  assert.match(html, /<math-display>x<\/math-display>/);
});

test("interrupts list-item paragraph for display math without blank line", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("- item\n  $$\n  x\n  $$");
  assert.match(html, /<li>\s*(?:<p>)?item(?:<\/p>)?\s*<math-display>x<\/math-display>\s*<\/li>/);
});

test("interrupts blockquote paragraph for display math without blank line", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("> item\n> $$\n> y\n> $$");
  assert.match(html, /<blockquote>\s*<p>item<\/p>\s*<math-display>y<\/math-display>\s*<\/blockquote>/);
});

test("renders blockquote multiline display math with trailing spaces on closing delimiter", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("> $$\n> x\n> $$   ");
  assert.match(html, /<math-display>x<\/math-display>/);
});

test("normalizes multiline display math indentation inside blockquote", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("> $$\n>   y\n> $$");
  assert.match(html, /<math-display>y<\/math-display>/);
});

test("does not expand wikilinks or math inside inline code and fences", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("`$x$ [[Home]]`\n\n```md\n[[Home]] $x$\n```");
  assert.match(html, /<code>\$x\$ \[\[Home\]\]<\/code>/);
  assert.match(html, /<pre><code class="language-md">\[\[Home\]\] \$x\$\n<\/code><\/pre>/);
  assert.equal(html.includes("data-wikilink"), false);
  assert.equal(html.includes("<math-inline>"), false);
  assert.equal(html.includes("<math-display>"), false);
});

test("does not parse inline math when delimiters touch alphanumeric characters", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("foo$x$bar");
  assert.equal(html, "<p>foo$x$bar</p>");
});

test("does not greedily parse currency-like dollars and still parses valid inline math", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("cost $5 and $x$ plus $x + y$");
  assert.equal(html, "<p>cost $5 and <math-inline>x</math-inline> plus <math-inline>x + y</math-inline></p>");
});

test("does not allow inline math to span newlines", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("a $x\ny$ b");
  assert.equal(html, "<p>a $x\ny$ b</p>");
});

test("treats single-backslash escaped dollar as non-math opener", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("\\$x$");
  assert.equal(html, "<p>$x$</p>");
});

test("uses backslash parity for escaped-dollar handling in inline math", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("\\\\$x$");
  assert.equal(html, "<p>\\<math-inline>x</math-inline></p>");
});

test("does not autolink bare urls but still renders markdown links", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("Visit http://example.com and [Example](http://example.com).");
  assert.match(html, /Visit http:\/\/example\.com and <a href="http:\/\/example\.com">Example<\/a>\./);
  assert.equal(html.includes('href="http://example.com">http://example.com</a>'), false);
});

test("keeps raw html escaped by default", () => {
  const rendering = createMarkdownRendering({ renderMath });
  assert.equal(rendering.render("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

test("preserves literal U+E000 character in prose", () => {
  const rendering = createMarkdownRendering({ renderMath });
  assert.equal(rendering.render("before \uE000 after"), "<p>before \uE000 after</p>");
});

test("preserves literal U+E000 character in fenced code", () => {
  const rendering = createMarkdownRendering({ renderMath });
  assert.match(rendering.render("```txt\n\uE000\n```"), /<pre><code class="language-txt">\n<\/code><\/pre>/);
});

test("preserves literal dynamic sentinel candidate text in prose", () => {
  const rendering = createMarkdownRendering({ renderMath });
  assert.equal(rendering.render("before CDWIKIPIPE0TOKEN after"), "<p>before CDWIKIPIPE0TOKEN after</p>");
});

test("preserves literal dynamic sentinel candidate text inside wikilink label", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("[[Target|before CDWIKIPIPE0TOKEN after]]");
  assert.equal(html, '<p><a href="#" data-wikilink="Target">before CDWIKIPIPE0TOKEN after</a></p>');
});

test("renders obsidian image embeds as images", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("![[Pasted image 20260507134701.png]]");
  assert.match(html, /<img src="Pasted image 20260507134701\.png" alt="Pasted image 20260507134701\.png">/);
  assert.equal(html.includes("data-wikilink"), false);
});

test("treats image embeds with label separators as literal text", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("![[Pasted image.png|thumb]]");
  assert.equal(html, "<p>![[Pasted image.png|thumb]]</p>");
});

test("parses image embeds and wikilinks in the same paragraph", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("See ![[Pasted image.png]] and [[Home|Start]].");
  assert.match(html, /See <img src="Pasted image\.png" alt="Pasted image\.png"> and <a href="#" data-wikilink="Home">Start<\/a>\./);
});

test("does not parse obsidian image embeds inside code spans or fences", () => {
  const rendering = createMarkdownRendering({ renderMath });
  const html = rendering.render("`![[Pasted image 20260507134701.png]]`\n\n```md\n![[Pasted image 20260507134701.png]]\n```");
  assert.match(html, /<code>!\[\[Pasted image 20260507134701\.png\]\]<\/code>/);
  assert.match(html, /<pre><code class="language-md">!\[\[Pasted image 20260507134701\.png\]\]\n<\/code><\/pre>/);
});
