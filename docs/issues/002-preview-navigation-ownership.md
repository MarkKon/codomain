# Consolidate Markdown Preview Navigation Ownership

Type: AFK
Label: needs-triage

## What to build

Make Markdown Preview navigation a single coherent behavior instead of two loosely synchronized histories. Preserve the current back/forward buttons, browser history integration, mouse back/forward buttons, terminal focus restoration, and Neovim activation behavior.

The slice should choose the smallest behavior-preserving consolidation that removes duplicated navigation ownership between the Markdown Preview and the Preview Navigation controller. The resulting module should make it clear which code owns Displayed Markdown File transitions and which adapter activates a Markdown File in Neovim.

## Acceptance criteria

- [ ] There is one clear module responsible for Markdown Preview navigation state and browser-history coordination.
- [ ] Back and forward navigation still update the Markdown Preview and activate the corresponding Markdown File in Neovim.
- [ ] Button disabled state, mouse buttons 3/4, and explicit terminal focus restoration keep their current behavior.
- [ ] Tests cover Wikilink navigation, browser back/forward navigation, button state, and Neovim activation through the consolidated navigation behavior.
- [ ] Existing `npm test` passes.

## Blocked by

- `docs/issues/001-preview-refresh-module.md`
