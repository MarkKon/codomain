export function createPreviewRefreshController({
  readActiveMarkdownFile,
  markdownPreview,
  onPathTransition,
  onRenderedPathChange,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  refreshDelayMs = 80,
}) {
  let refreshInFlight = false;
  let refreshTimer = null;
  let pendingCursorLine = null;

  function applyPreviewFile(file) {
    if (!file) return false;
    const previousFile = markdownPreview.currentFile ? markdownPreview.currentFile() : null;
    const previousPath = markdownPreview.currentPath();
    if (!markdownPreview.renderFile(file)) return false;
    replayPendingCursorIfMatched(file.path);
    onPathTransition?.(previousPath, file.path, { previousFile, nextFile: file });
    onRenderedPathChange?.();
    return true;
  }

  async function refreshFromActiveMarkdownFile() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const file = await readActiveMarkdownFile();
      applyPreviewFile(file);
    } catch {
      // Neovim can briefly reject remote calls while starting or exiting.
    } finally {
      refreshInFlight = false;
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeoutFn(refreshTimer);
    refreshTimer = setTimeoutFn(() => {
      refreshTimer = null;
      refreshFromActiveMarkdownFile();
    }, refreshDelayMs);
  }

  function followPreviewCursorLine(payload) {
    const cursorPayload = normalizeCursorPayload(payload);
    const path = cursorPayload?.path;
    const line = cursorPayload?.line;
    if (typeof path !== "string" || !Number.isInteger(line) || line < 1) return;
    if (markdownPreview.currentPath?.() !== path) {
      pendingCursorLine = { path, line };
      return;
    }
    pendingCursorLine = null;
    markdownPreview.followCursorLine?.({ path, line });
  }

  function replayPendingCursorIfMatched(renderedPath) {
    if (!pendingCursorLine || pendingCursorLine.path !== renderedPath) return;
    const payload = pendingCursorLine;
    pendingCursorLine = null;
    markdownPreview.followCursorLine?.(payload);
  }

  return {
    applyPreviewFile,
    scheduleRefresh,
    refreshFromActiveMarkdownFile,
    followPreviewCursorLine,
  };
}

export async function wirePreviewRefresh({ listenToEvent, setIntervalFn, previewRefresh }) {
  await listenToEvent("nvim://buffer-changed", previewRefresh.scheduleRefresh);
  await listenToEvent("nvim://cursor-line-changed", (event) =>
    previewRefresh.followPreviewCursorLine(event?.payload ?? event),
  );
  setIntervalFn(previewRefresh.refreshFromActiveMarkdownFile, 1000);
}

function normalizeCursorPayload(payloadOrEvent) {
  if (!payloadOrEvent || typeof payloadOrEvent !== "object") return null;
  if (payloadOrEvent.payload && typeof payloadOrEvent.payload === "object") return payloadOrEvent.payload;
  return payloadOrEvent;
}
