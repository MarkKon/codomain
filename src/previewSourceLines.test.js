import assert from "node:assert/strict";
import test from "node:test";
import {
  findNearestSourceLineBlock,
  findSourceLineBlockForLine,
  isInteractivePreviewElement,
  maybeGetScrollTopForLine,
  parseSourceLineSpan,
} from "./previewSourceLines.js";

function makeSourceLineElement({ startLine, endLine = null, top = 0, bottom = 0 }) {
  return {
    dataset: {
      sourceLine: String(startLine),
      ...(endLine == null ? {} : { sourceLineEnd: String(endLine) }),
    },
    getBoundingClientRect: () => ({ top, bottom }),
  };
}

function makeHost(blocks, { top = 0, height = 600, scrollTop = 0 } = {}) {
  return {
    scrollTop,
    querySelectorAll(selector) {
      if (selector !== "[data-source-line]") return [];
      return blocks;
    },
    getBoundingClientRect: () => ({ top, height }),
  };
}

test("parseSourceLineSpan reads start and optional end source lines", () => {
  assert.deepEqual(parseSourceLineSpan(makeSourceLineElement({ startLine: 7 })), { startLine: 7, endLine: 7 });
  assert.deepEqual(parseSourceLineSpan(makeSourceLineElement({ startLine: 7, endLine: 11 })), {
    startLine: 7,
    endLine: 11,
  });
});

test("findSourceLineBlockForLine checks containing block first", () => {
  const blocks = [
    makeSourceLineElement({ startLine: 2, endLine: 4 }),
    makeSourceLineElement({ startLine: 8, endLine: 9 }),
  ];
  const host = makeHost(blocks);

  assert.equal(findSourceLineBlockForLine({ host, line: 3 })?.element, blocks[0]);
});

test("findSourceLineBlockForLine falls back to nearest previous then nearest next", () => {
  const blocks = [
    makeSourceLineElement({ startLine: 2, endLine: 4 }),
    makeSourceLineElement({ startLine: 8, endLine: 9 }),
    makeSourceLineElement({ startLine: 15, endLine: 16 }),
  ];
  const host = makeHost(blocks);

  assert.equal(findSourceLineBlockForLine({ host, line: 6 })?.element, blocks[0]);
  assert.equal(findSourceLineBlockForLine({ host, line: 1 })?.element, blocks[0]);
  assert.equal(findSourceLineBlockForLine({ host, line: 12 })?.element, blocks[1]);
});

test("maybeGetScrollTopForLine keeps scroll when block is in the comfortable band", () => {
  const block = makeSourceLineElement({ startLine: 10, top: 220, bottom: 280 });
  const host = makeHost([block], { top: 100, height: 400, scrollTop: 300 });

  assert.equal(maybeGetScrollTopForLine({ host, line: 10 }), null);
});

test("maybeGetScrollTopForLine places out-of-band target near one-third from top", () => {
  const block = makeSourceLineElement({ startLine: 10, top: 420, bottom: 470 });
  const host = makeHost([block], { top: 100, height: 400, scrollTop: 250 });

  assert.equal(maybeGetScrollTopForLine({ host, line: 10 }), 437);
});

test("findNearestSourceLineBlock selects nearest previous block for whitespace clicks", () => {
  const blocks = [
    makeSourceLineElement({ startLine: 3, top: 140, bottom: 190 }),
    makeSourceLineElement({ startLine: 8, top: 260, bottom: 320 }),
  ];
  const host = makeHost(blocks);
  const target = {
    closest: (selector) => (selector === "[data-source-line]" ? null : null),
  };

  assert.equal(findNearestSourceLineBlock({ host, target, clientY: 240 })?.element, blocks[0]);
  assert.equal(findNearestSourceLineBlock({ host, target, clientY: 130 })?.element, blocks[0]);
  assert.equal(findNearestSourceLineBlock({ host, target, clientY: 400 })?.element, blocks[1]);
});

test("findNearestSourceLineBlock ignores interactive content and uses mapped ancestor", () => {
  const mapped = makeSourceLineElement({ startLine: 6, top: 200, bottom: 240 });
  const host = makeHost([mapped]);
  const nonInteractiveTarget = {
    closest: (selector) => {
      if (selector === "[data-source-line]") return mapped;
      if (selector === "a,button,input,select,textarea,option,label,summary,[data-wikilink]") return null;
      return null;
    },
  };
  const interactiveTarget = {
    closest: (selector) => {
      if (selector === "a,button,input,select,textarea,option,label,summary,[data-wikilink]") {
        return { tagName: "A" };
      }
      return null;
    },
  };

  assert.equal(isInteractivePreviewElement(nonInteractiveTarget), false);
  assert.equal(isInteractivePreviewElement(interactiveTarget), true);
  assert.equal(findNearestSourceLineBlock({ host, target: nonInteractiveTarget, clientY: 220 })?.element, mapped);
  assert.equal(findNearestSourceLineBlock({ host, target: interactiveTarget, clientY: 220 }), null);
});
