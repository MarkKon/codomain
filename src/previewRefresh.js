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

  function applyPreviewFile(file) {
    if (!file) return false;
    const previousPath = markdownPreview.currentPath();
    if (!markdownPreview.renderFile(file)) return false;
    onPathTransition?.(previousPath, file.path);
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

  return {
    applyPreviewFile,
    scheduleRefresh,
    refreshFromActiveMarkdownFile,
  };
}

export async function wirePreviewRefresh({ listenToEvent, setIntervalFn, previewRefresh }) {
  await listenToEvent("nvim://buffer-changed", previewRefresh.scheduleRefresh);
  setIntervalFn(previewRefresh.refreshFromActiveMarkdownFile, 1000);
}
