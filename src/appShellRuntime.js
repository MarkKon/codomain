export function createAppShellRuntime({
  initializeRoot,
  onRootInitialized,
  setupModes,
  setupPreviewNavigation,
  setupTerminal,
  startTerminal,
  loadReadmeMarkdown,
  wirePreviewRefresh,
  listenForModeChanges,
  focusTerminal,
  stopNeovim = async () => {},
  onRootChanged = () => {},
  resetMarkdownPreview = () => {},
  resetPreviewNavigation = () => {},
  resetTerminal = () => {},
  fitTerminalNow = () => {},
  getTerminalDimensions = () => ({ rows: 0, cols: 0 }),
  startNeovim = async () => {},
  scheduleTerminalFit = () => {},
}) {
  async function boot() {
    const root = await initializeRoot();
    onRootInitialized(root);
    setupModes();
    setupPreviewNavigation();
    setupTerminal();
    await startTerminal();
    await loadReadmeMarkdown(true);
    await wirePreviewRefresh();
    await listenForModeChanges();
    focusTerminal();
  }

  async function changeRoot(root) {
    await stopNeovim();
    onRootChanged(root);
    resetMarkdownPreview();
    resetPreviewNavigation();
    resetTerminal();
    fitTerminalNow();
    const { rows, cols } = getTerminalDimensions();
    await startNeovim({ root, rows, cols });
    await loadReadmeMarkdown(true);
    scheduleTerminalFit();
    focusTerminal();
  }

  return {
    boot,
    changeRoot,
  };
}
