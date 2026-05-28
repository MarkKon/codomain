export function createPreviewNavigationController({
  markdownPreview,
  backButton,
  forwardButton,
  markdownPane,
  focusTerminal,
  activateMarkdownFile,
  historyApi = window.history,
  locationHref = () => window.location.href,
  addWindowListener = (type, handler) => window.addEventListener(type, handler),
}) {
  const state = {
    previewHistoryIndex: 0,
    previewHistoryGeneration: 0,
    handlingPopState: false,
  };

  function currentPreviewHistoryState() {
    return {
      previewGeneration: state.previewHistoryGeneration,
      previewIndex: state.previewHistoryIndex,
    };
  }

  function syncButtons() {
    backButton.disabled = !markdownPreview.canGoBack();
    forwardButton.disabled = !markdownPreview.canGoForward();
  }

  function recordTransition(previousPath, nextPath) {
    if (!nextPath || previousPath === nextPath) return;
    if (state.handlingPopState) return;
    state.previewHistoryIndex += 1;
    historyApi.pushState(currentPreviewHistoryState(), "", locationHref());
  }

  function resetHistoryState() {
    state.previewHistoryGeneration += 1;
    state.previewHistoryIndex = 0;
    state.handlingPopState = false;
    historyApi.replaceState(currentPreviewHistoryState(), "", locationHref());
    syncButtons();
  }

  async function onPopState(event) {
    const generation = Number(event.state?.previewGeneration);
    const nextIndex = Number(event.state?.previewIndex);
    if (
      !Number.isFinite(generation) ||
      generation !== state.previewHistoryGeneration ||
      !Number.isFinite(nextIndex)
    ) {
      historyApi.replaceState(currentPreviewHistoryState(), "", locationHref());
      return;
    }
    const direction = nextIndex - state.previewHistoryIndex;
    state.handlingPopState = true;
    try {
      const file =
        direction < 0 ? markdownPreview.goBack() : direction > 0 ? markdownPreview.goForward() : null;
      if (file) await activateMarkdownFile(file.path);
      state.previewHistoryIndex = nextIndex;
      syncButtons();
    } finally {
      state.handlingPopState = false;
      focusTerminal({ explicit: true });
    }
  }

  function setup() {
    resetHistoryState();
    backButton.addEventListener("click", () => {
      if (!markdownPreview.canGoBack()) return;
      historyApi.back();
      focusTerminal({ explicit: true });
    });
    forwardButton.addEventListener("click", () => {
      if (!markdownPreview.canGoForward()) return;
      historyApi.forward();
      focusTerminal({ explicit: true });
    });
    addWindowListener("popstate", onPopState);
    addWindowListener("mouseup", (event) => {
      if (event.button === 3 && markdownPreview.canGoBack()) {
        historyApi.back();
        focusTerminal({ explicit: true });
      }
      if (event.button === 4 && markdownPreview.canGoForward()) {
        historyApi.forward();
        focusTerminal({ explicit: true });
      }
    });
    markdownPane.addEventListener("pointerup", () => focusTerminal({ explicit: true }));
    markdownPane.addEventListener("click", () => focusTerminal({ explicit: true }));
    syncButtons();
  }

  return {
    setup,
    syncButtons,
    recordTransition,
    resetHistoryState,
  };
}
