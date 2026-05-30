# Make the App Shell a Thin Runtime

Type: AFK
Label: needs-triage

## What to build

Reduce the App Shell to bootstrapping, DOM lookup, adapter construction, and module wiring. Root Folder changes, Preview Refresh, Markdown Preview navigation, view mode behavior, and Neovim terminal operations should be called through named modules rather than living as intertwined functions in `src/main.js`.

This issue should not change visible behavior. Its purpose is locality: a sub-agent working on Root Folder selection, Preview Refresh, or terminal lifecycle should not need to understand unrelated App Shell internals.

## Acceptance criteria

- [ ] `src/main.js` primarily wires modules and adapters; workflow-heavy behavior is moved behind named module interfaces.
- [ ] Root Folder change still stops Neovim, resets the Markdown Preview and navigation state, restarts Neovim, attempts `README.md`, fits the terminal, and restores terminal focus.
- [ ] Startup still initializes the Root Folder, starts Neovim, loads `README.md` when present, listens for Neovim buffer changes, listens for view mode menu events, and starts periodic Preview Refresh.
- [ ] Tests cover the moved App Shell workflows through module-level interfaces or focused adapter tests.
- [ ] Existing `npm test` passes.

## Blocked by

- `docs/issues/001-preview-refresh-module.md`
- `docs/issues/002-preview-navigation-ownership.md`
