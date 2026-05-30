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
    displayedFile: null,
    backStack: [],
    forwardStack: [],
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
    backButton.disabled = state.backStack.length === 0;
    forwardButton.disabled = state.forwardStack.length === 0;
  }

  function toFileSnapshot(file) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") return null;
    return { path: file.path, content: file.content };
  }

  function navigateBackInPreview() {
    if (state.backStack.length === 0) return null;
    if (state.displayedFile) state.forwardStack.push(state.displayedFile);
    const next = state.backStack.pop();
    state.displayedFile = next;
    markdownPreview.renderFile(next, { scrollToTop: true });
    return next;
  }

  function navigateForwardInPreview() {
    if (state.forwardStack.length === 0) return null;
    if (state.displayedFile) state.backStack.push(state.displayedFile);
    const next = state.forwardStack.pop();
    state.displayedFile = next;
    markdownPreview.renderFile(next, { scrollToTop: true });
    return next;
  }

  function recordTransition(previousPath, nextPath, details = {}) {
    const previousFile =
      toFileSnapshot(details.previousFile) ??
      toFileSnapshot(typeof previousPath === "object" ? previousPath : null);
    const nextFile =
      toFileSnapshot(details.nextFile) ??
      toFileSnapshot(typeof nextPath === "object" ? nextPath : null);
    const previousTransitionPath = previousFile?.path ?? (typeof previousPath === "string" ? previousPath : null);
    const nextTransitionPath = nextFile?.path ?? (typeof nextPath === "string" ? nextPath : null);
    if (!nextTransitionPath) return;
    if (state.handlingPopState) return;

    if (nextFile && (!state.displayedFile || state.displayedFile.path === nextTransitionPath)) {
      state.displayedFile = nextFile;
    }
    if (previousTransitionPath === nextTransitionPath) return;

    if (previousFile && (!state.displayedFile || state.displayedFile.path !== previousFile.path)) {
      state.displayedFile = previousFile;
    }
    if (state.displayedFile && state.displayedFile.path !== nextTransitionPath) {
      state.backStack.push(state.displayedFile);
      state.forwardStack = [];
    }
    if (nextFile) state.displayedFile = nextFile;
    state.previewHistoryIndex += 1;
    historyApi.pushState(currentPreviewHistoryState(), "", locationHref());
    syncButtons();
  }

  function resetHistoryState() {
    state.displayedFile = null;
    state.backStack = [];
    state.forwardStack = [];
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
      const file = direction < 0 ? navigateBackInPreview() : direction > 0 ? navigateForwardInPreview() : null;
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
      if (state.backStack.length === 0) return;
      historyApi.back();
      focusTerminal({ explicit: true });
    });
    forwardButton.addEventListener("click", () => {
      if (state.forwardStack.length === 0) return;
      historyApi.forward();
      focusTerminal({ explicit: true });
    });
    addWindowListener("popstate", onPopState);
    addWindowListener("mouseup", (event) => {
      if (event.button === 3 && state.backStack.length > 0) {
        historyApi.back();
        focusTerminal({ explicit: true });
      }
      if (event.button === 4 && state.forwardStack.length > 0) {
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
