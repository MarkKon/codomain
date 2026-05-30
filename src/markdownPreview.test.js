import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownPreview } from "./markdownPreview.js";
import { createMarkdownRendering } from "./markdownRendering.js";
import { escapeHtml } from "./markdownEscaping.js";

function renderMath(source, displayMode) {
  return displayMode ? `<math-display>${source}</math-display>` : `<math-inline>${source}</math-inline>`;
}

const markdownRendering = createMarkdownRendering({ renderMath });

test("renders block markdown without changing existing syntax", () => {
  const html = markdownRendering.render("# Title\n\n- one\n- **two**\n\n```js\nconst value = 1 < 2;\n```");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<li><strong>two<\/strong><\/li>/);
  assert.match(html, /<pre><code class="language-js">const value = 1 &lt; 2;\n<\/code><\/pre>/);
});

test("renders wikilinks with targets and labels", () => {
  assert.equal(
    markdownRendering.render("Open [[Nested/Deep Note|deep note]] and [[Home]]."),
    '<p>Open <a href="#" data-wikilink="Nested/Deep Note">deep note</a> and <a href="#" data-wikilink="Home">Home</a>.</p>',
  );
});

test("escapes markdown text and wikilink labels", () => {
  assert.equal(
    markdownRendering.render("<script>x</script> [[A&B|<Label>]]"),
    '<p>&lt;script&gt;x&lt;/script&gt; <a href="#" data-wikilink="A&amp;B">&lt;Label&gt;</a></p>',
  );
});

test("renders inline and block math in preview rendering", () => {
  assert.equal(
    markdownRendering.render("Inline $x^2$.\n\n$$\ny = 1\n$$"),
    "<p>Inline <math-inline>x^2</math-inline>.</p>\n<math-display>y = 1</math-display>",
  );
});

test("escapes standalone html values", () => {
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#039;");
});

test("reset clears displayed markdown file", () => {
  const host = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], prepend() {} };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
  });

  preview.renderFile({ path: "Home.md", content: "# Home" });
  preview.reset();
  assert.equal(preview.currentPath(), null);
  assert.equal(host.innerHTML, "");
});

test("exposes current markdown path for transition checks", () => {
  const host = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], prepend() {} };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
  });

  assert.equal(preview.currentPath(), null);
  preview.renderFile({ path: "Home.md", content: "# Home" });
  assert.equal(preview.currentPath(), "Home.md");
  preview.renderFile({ path: "Home.md", content: "# Home v2" });
  assert.equal(preview.currentPath(), "Home.md");
  preview.reset();
  assert.equal(preview.currentPath(), null);
});

test("wikilink navigation reports path transitions to app shell", async () => {
  const listeners = [];
  const host = {
    innerHTML: "",
    scrollTop: 0,
    prepend() {},
    querySelectorAll: () => [{ dataset: { wikilink: "Target" }, addEventListener: (_t, cb) => listeners.push(cb) }],
  };
  const transitions = [];
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => ({ path: "Target.md", content: "# Target" }),
    onPathTransition: (previousPath, nextPath) => transitions.push([previousPath, nextPath]),
  });

  preview.renderFile({ path: "Home.md", content: "Go [[Target]]" });
  await listeners[0]({ preventDefault() {} });
  assert.deepEqual(transitions, [["Home.md", "Target.md"]]);
});
