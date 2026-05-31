const SOURCE_LINE_SELECTOR = "[data-source-line]";
const INTERACTIVE_PREVIEW_SELECTOR = "a,button,input,select,textarea,option,label,summary,[data-wikilink]";
const COMFORT_BAND_TOP_RATIO = 0.2;
const COMFORT_BAND_BOTTOM_RATIO = 0.8;

export function parseSourceLineSpan(element) {
  const startLine = Number(element?.dataset?.sourceLine);
  if (!Number.isInteger(startLine) || startLine < 1) return null;
  const endLineRaw = Number(element?.dataset?.sourceLineEnd);
  const endLine = Number.isInteger(endLineRaw) && endLineRaw >= startLine ? endLineRaw : startLine;
  return { startLine, endLine };
}

export function findSourceLineBlockForLine({ host, line }) {
  if (!Number.isInteger(line) || line < 1) return null;
  const blocks = readSourceLineBlocks(host);
  if (blocks.length === 0) return null;

  const containing = blocks.find((block) => line >= block.startLine && line <= block.endLine);
  if (containing) return containing;

  const previous = blocks
    .filter((block) => block.endLine < line)
    .reduce((best, block) => (best == null || block.endLine > best.endLine ? block : best), null);
  if (previous) return previous;

  return blocks
    .filter((block) => block.startLine > line)
    .reduce((best, block) => (best == null || block.startLine < best.startLine ? block : best), null);
}

export function maybeGetScrollTopForLine({ host, line }) {
  const block = findSourceLineBlockForLine({ host, line });
  if (!block) return null;

  const targetRect = block.element?.getBoundingClientRect?.();
  const containerRect = host?.getBoundingClientRect?.();
  if (!hasFiniteRect(targetRect) || !hasFiniteContainerRect(containerRect)) return null;

  const bandTop = containerRect.top + containerRect.height * COMFORT_BAND_TOP_RATIO;
  const bandBottom = containerRect.top + containerRect.height * COMFORT_BAND_BOTTOM_RATIO;
  if (targetRect.top >= bandTop && targetRect.bottom <= bandBottom) return null;

  const desiredTop = containerRect.top + containerRect.height / 3;
  const currentScrollTop = Number(host?.scrollTop) || 0;
  return Math.max(0, Math.round(currentScrollTop + (targetRect.top - desiredTop)));
}

export function isInteractivePreviewElement(target) {
  return Boolean(target?.closest?.(INTERACTIVE_PREVIEW_SELECTOR));
}

export function findNearestSourceLineBlock({ host, target, clientY }) {
  const normalizedTarget = normalizeElementTarget(target);
  if (!normalizedTarget) return null;
  if (isInteractivePreviewElement(normalizedTarget)) return null;

  const mappedTarget = normalizedTarget.closest?.(SOURCE_LINE_SELECTOR);
  const mappedSpan = parseSourceLineSpan(mappedTarget);
  if (mappedTarget && mappedSpan) {
    return { element: mappedTarget, ...mappedSpan };
  }

  const blocks = readSourceLineBlocks(host);
  if (blocks.length === 0) return null;
  if (!Number.isFinite(clientY)) return blocks[0];

  const previous = blocks
    .filter((block) => {
      const rect = block.element?.getBoundingClientRect?.();
      return hasFiniteRect(rect) && rect.top <= clientY;
    })
    .reduce((best, block) => {
      const rect = block.element.getBoundingClientRect();
      const bestRect = best?.element.getBoundingClientRect();
      return best == null || rect.top > bestRect.top ? block : best;
    }, null);
  if (previous) return previous;

  return blocks
    .filter((block) => {
      const rect = block.element?.getBoundingClientRect?.();
      return hasFiniteRect(rect) && rect.top > clientY;
    })
    .reduce((best, block) => {
      const rect = block.element.getBoundingClientRect();
      const bestRect = best?.element.getBoundingClientRect();
      return best == null || rect.top < bestRect.top ? block : best;
    }, null);
}

function normalizeElementTarget(target) {
  if (!target || typeof target !== "object") return null;
  if (typeof target.closest === "function") return target;
  return target.parentElement && typeof target.parentElement.closest === "function" ? target.parentElement : null;
}

function readSourceLineBlocks(host) {
  const elements = host?.querySelectorAll?.(SOURCE_LINE_SELECTOR) ?? [];
  const blocks = [];
  for (const element of elements) {
    const span = parseSourceLineSpan(element);
    if (!span) continue;
    blocks.push({ element, ...span });
  }
  return blocks;
}

function hasFiniteRect(rect) {
  return Boolean(rect && Number.isFinite(rect.top) && Number.isFinite(rect.bottom));
}

function hasFiniteContainerRect(rect) {
  return Boolean(rect && Number.isFinite(rect.top) && Number.isFinite(rect.height));
}
