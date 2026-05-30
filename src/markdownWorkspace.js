export function createMarkdownWorkspace({
  getRoot,
  readMarkdown,
  applyPreviewFile,
  showPreviewEmpty,
  syncPreviewNavigationButtons,
  openMarkdownInNeovim,
}) {
  async function loadMarkdown(path, tolerateMissing = false) {
    try {
      const file = await readMarkdown({ root: getRoot(), path });
      applyPreviewFile(file);
    } catch (error) {
      if (!tolerateMissing) throw error;
      showPreviewEmpty();
      syncPreviewNavigationButtons();
    }
  }

  async function activateMarkdownFile(path) {
    await openMarkdownInNeovim({ path });
  }

  return {
    loadMarkdown,
    activateMarkdownFile,
  };
}
