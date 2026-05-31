import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownPreview } from "./markdownPreview.js";
import { createMarkdownRendering } from "./markdownRendering.js";
import { escapeHtml } from "./markdownEscaping.js";

function renderMath(source, displayMode) {
  return displayMode ? `<math-display>${source}</math-display>` : `<math-inline>${source}</math-inline>`;
}

function stripSourceLineMetadata(html) {
  return html.replace(/\sdata-source-line(?:-end)?="[^"]*"/g, "");
}

const markdownRendering = createMarkdownRendering({ renderMath });

test("renders block markdown without changing existing syntax", () => {
  const html = stripSourceLineMetadata(
    markdownRendering.render("# Title\n\n- one\n- **two**\n\n```js\nconst value = 1 < 2;\n```"),
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<li><strong>two<\/strong><\/li>/);
  assert.match(html, /<pre><code class="language-js">const value = 1 &lt; 2;\n<\/code><\/pre>/);
});

test("renders wikilinks with targets and labels", () => {
  assert.equal(
    stripSourceLineMetadata(markdownRendering.render("Open [[Nested/Deep Note|deep note]] and [[Home]].")),
    '<p>Open <a href="#" data-wikilink="Nested/Deep Note">deep note</a> and <a href="#" data-wikilink="Home">Home</a>.</p>',
  );
});

test("escapes markdown text and wikilink labels", () => {
  assert.equal(
    stripSourceLineMetadata(markdownRendering.render("<script>x</script> [[A&B|<Label>]]")),
    '<p>&lt;script&gt;x&lt;/script&gt; <a href="#" data-wikilink="A&amp;B">&lt;Label&gt;</a></p>',
  );
});

test("renders inline and block math in preview rendering", () => {
  assert.equal(
    stripSourceLineMetadata(markdownRendering.render("Inline $x^2$.\n\n$$\ny = 1\n$$")),
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

test("dblclick on mapped preview content jumps Neovim cursor to mapped source line", async () => {
  const handlers = new Map();
  const mappedBlock = {
    dataset: { sourceLine: "14" },
    getBoundingClientRect: () => ({ top: 230, bottom: 280 }),
  };
  const host = {
    innerHTML: "",
    scrollTop: 0,
    prepend() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    querySelectorAll(selector) {
      if (selector === "[data-wikilink]") return [];
      if (selector === "[data-source-line]") return [mappedBlock];
      return [];
    },
    getBoundingClientRect: () => ({ top: 100, height: 500 }),
  };
  const jumps = [];
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
    moveCursorToSourceLine: async (path, line) => jumps.push([path, line]),
  });

  preview.renderFile({ path: "Home.md", content: "Hello" });
  await handlers.get("dblclick")({
    clientY: 240,
    target: {
      closest: (selector) => (selector === "[data-source-line]" ? mappedBlock : null),
    },
  });
  assert.deepEqual(jumps, [["Home.md", 14]]);
});

test("dblclick on interactive preview content does not trigger preview jump", async () => {
  const handlers = new Map();
  const mappedBlock = {
    dataset: { sourceLine: "14" },
    getBoundingClientRect: () => ({ top: 230, bottom: 280 }),
  };
  const host = {
    innerHTML: "",
    scrollTop: 0,
    prepend() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    querySelectorAll(selector) {
      if (selector === "[data-wikilink]") return [];
      if (selector === "[data-source-line]") return [mappedBlock];
      return [];
    },
    getBoundingClientRect: () => ({ top: 100, height: 500 }),
  };
  let jumped = false;
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
    moveCursorToSourceLine: async () => {
      jumped = true;
    },
  });

  preview.renderFile({ path: "Home.md", content: "Hello" });
  await handlers.get("dblclick")({
    clientY: 240,
    target: {
      closest: (selector) => {
        if (selector === "a,button,input,select,textarea,option,label,summary,[data-wikilink]") return { tagName: "A" };
        if (selector === "[data-source-line]") return mappedBlock;
        return null;
      },
    },
  });
  assert.equal(jumped, false);
});

test("follows Neovim cursor line for displayed path only and avoids same-line re-scroll", () => {
  const handlers = new Map();
  const block = {
    dataset: { sourceLine: "9" },
    getBoundingClientRect: () => ({ top: 460, bottom: 520 }),
  };
  const host = {
    innerHTML: "",
    scrollTop: 120,
    prepend() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    querySelectorAll(selector) {
      if (selector === "[data-wikilink]") return [];
      if (selector === "[data-source-line]") return [block];
      return [];
    },
    getBoundingClientRect: () => ({ top: 100, height: 500 }),
  };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
  });

  preview.renderFile({ path: "Home.md", content: "Hello" });
  assert.equal(preview.followCursorLine({ path: "Other.md", line: 9 }), false);
  assert.equal(host.scrollTop, 120);

  assert.equal(preview.followCursorLine({ path: "Home.md", line: 9 }), true);
  assert.equal(host.scrollTop, 313);

  host.scrollTop = 500;
  assert.equal(preview.followCursorLine({ path: "Home.md", line: 9 }), false);
  assert.equal(host.scrollTop, 500);
});

test("preview jump suppresses immediate same-line follow after Neovim cursor move", async () => {
  const handlers = new Map();
  const block = {
    dataset: { sourceLine: "14" },
    getBoundingClientRect: () => ({ top: 640, bottom: 700 }),
  };
  const host = {
    innerHTML: "",
    scrollTop: 100,
    prepend() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    querySelectorAll(selector) {
      if (selector === "[data-wikilink]") return [];
      if (selector === "[data-source-line]") return [block];
      return [];
    },
    getBoundingClientRect: () => ({ top: 100, height: 500 }),
  };
  const preview = createMarkdownPreview({
    host,
    renderMath,
    openWikilink: async () => {
      throw new Error("unused");
    },
    moveCursorToSourceLine: async () => {},
  });

  preview.renderFile({ path: "Home.md", content: "Hello" });
  await handlers.get("dblclick")({
    clientY: 450,
    target: {
      closest: (selector) => (selector === "[data-source-line]" ? block : null),
    },
  });

  assert.equal(preview.followCursorLine({ path: "Home.md", line: 14 }), false);
  assert.equal(host.scrollTop, 100);
  assert.equal(preview.followCursorLine({ path: "Home.md", line: 15 }), true);
});
