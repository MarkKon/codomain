import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownPreview } from "./markdownPreview.js";
import { createMarkdownRendering } from "./markdownRendering.js";
import { escapeHtml } from "./markdownEscaping.js";

function renderMath(source, displayMode) {
  return displayMode ? `<math-block>${source}</math-block>` : `<math-inline>${source}</math-inline>`;
}

const markdownRendering = createMarkdownRendering({ renderMath });

test("renders block markdown without changing existing syntax", () => {
  assert.equal(
    markdownRendering.render("# Title\n\n- one\n- **two**\n\n```js\nconst value = 1 < 2;\n```"),
    [
      "<h1>Title</h1>",
      "",
      "<ul>",
      "<li>one</li>",
      "<li><strong>two</strong></li>",
      "</ul>",
      "",
      "<pre><code>const value = 1 &lt; 2;</code></pre>",
    ].join("\n"),
  );
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

test("delegates inline and block math rendering", () => {
  assert.equal(
    markdownRendering.render("Inline $x^2$.\n$$\ny = 1\n$$"),
    "<p>Inline <math-inline>x^2</math-inline>.</p>\n<div class=\"math-block\"><math-block>y = 1</math-block></div>",
  );
});

test("escapes standalone html values", () => {
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#039;");
});

test("tracks markdown preview history for back and forward navigation", () => {
  const host = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], prepend() {} };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
  });
  const one = { path: "Home.md", content: "# Home" };
  const two = { path: "Daily Log.md", content: "# Daily Log" };
  const three = { path: "TODO.md", content: "# TODO" };

  assert.equal(preview.renderFile(one), true);
  assert.equal(preview.renderFile(two), true);
  assert.equal(preview.renderFile(three), true);
  assert.equal(preview.canGoBack(), true);
  assert.equal(preview.canGoForward(), false);

  assert.equal(preview.goBack().path, "Daily Log.md");
  assert.equal(preview.goBack().path, "Home.md");
  assert.equal(preview.canGoBack(), false);
  assert.equal(preview.canGoForward(), true);

  assert.equal(preview.goForward().path, "Daily Log.md");
  assert.equal(preview.goForward().path, "TODO.md");
  assert.equal(preview.canGoForward(), false);
});

test("returns activation target when navigating preview history", () => {
  const host = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], prepend() {} };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
  });
  const one = { path: "Home.md", content: "# Home" };
  const two = { path: "Daily Log.md", content: "# Daily Log" };

  preview.renderFile(one);
  preview.renderFile(two);
  const previous = preview.goBack();
  assert.equal(previous.path, "Home.md");
  assert.equal(host.innerHTML.includes("<h1>Home</h1>"), true);
});

test("reset clears preview navigation history", () => {
  const host = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], prepend() {} };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
  });

  preview.renderFile({ path: "Home.md", content: "# Home" });
  preview.renderFile({ path: "TODO.md", content: "# TODO" });
  assert.equal(preview.canGoBack(), true);
  preview.reset();
  assert.equal(preview.canGoBack(), false);
  assert.equal(preview.canGoForward(), false);
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
