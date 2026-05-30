# Make View Mode Behavior Deep or Absorb It

Type: AFK
Label: needs-triage

## What to build

Resolve the shallow View Mode policy module by either absorbing it into the thin App Shell runtime or deepening it into the single owner of view mode commands, focus policy, terminal fitting decisions, and DOM state updates.

This should preserve the current Neovim full view, split view, Markdown full view, toolbar buttons, menu events, keyboard shortcuts, terminal focus behavior, and terminal fitting behavior.

## Acceptance criteria

- [ ] View mode command parsing remains limited to the canonical `nvim`, `split`, and `markdown` values.
- [ ] Toolbar button state, shell `data-mode`, terminal fit scheduling, and terminal focus behavior remain unchanged.
- [ ] Menu events and keyboard shortcuts continue to reach the same view mode behavior.
- [ ] The deletion test no longer identifies the View Mode module as a pass-through: either it has a deeper interface or it has been removed.
- [ ] Existing `npm test` passes.

## Blocked by

- `docs/issues/005-app-shell-thin-runtime.md`
