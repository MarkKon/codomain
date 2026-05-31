export function createMarkdownWorkspace({
  getRoot,
  readMarkdown,
  applyPreviewFile,
  showPreviewEmpty,
  syncPreviewNavigationButtons,
  openMarkdownInNeovim,
}) {
  const READ_MARKDOWN_NOT_FOUND_PREFIX = "READ_MARKDOWN_NOT_FOUND:";

  async function loadMarkdown(path, tolerateMissing = false) {
    let file;
    try {
      file = await readMarkdown({ root: getRoot(), path });
    } catch (error) {
      if (tolerateMissing && path === "README.md" && isMissingReadmeError(error, path)) {
        showPreviewEmpty();
        syncPreviewNavigationButtons();
        return;
      }
      throw error;
    }

    applyPreviewFile(file);
    await activateMarkdownFile(file.path);
  }

  function isMissingReadmeError(error, path) {
    const message = error?.message ?? String(error);
    return message === `${READ_MARKDOWN_NOT_FOUND_PREFIX}${path}`;
  }

  async function activateMarkdownFile(path) {
    await openMarkdownInNeovim({ path });
  }

  return {
    loadMarkdown,
    activateMarkdownFile,
  };
}
