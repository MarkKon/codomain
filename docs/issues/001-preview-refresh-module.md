# Extract Preview Refresh Into a Deep Module

Type: AFK
Label: needs-triage

## What to build

Create a focused Preview Refresh module that owns the existing behavior for updating the Markdown Preview from the Active Markdown File. The slice should preserve current user behavior while moving the event coalescing, in-flight guard, polling fallback, duplicate Displayed Markdown File check, and Markdown Preview transition reporting out of the App Shell.

The App Shell should still receive Neovim buffer-change events and start the periodic refresh loop, but the refresh decision and ordering should live behind a small module interface. This issue is complete when a sub-agent can reason about Preview Refresh without reading the whole App Shell.

## Acceptance criteria

- [ ] Preview Refresh behavior remains unchanged for startup, Neovim buffer-change events, periodic polling, and missing/non-Markdown Active Markdown File responses.
- [ ] The App Shell no longer owns the preview refresh timer, in-flight refresh flag, duplicate render decision, and transition recording sequence directly.
- [ ] Tests cover coalesced rapid refresh requests, in-flight refresh suppression, no-op refresh for no Active Markdown File, and transition recording when the Displayed Markdown File path changes.
- [ ] Existing `npm test` passes.

## Blocked by

None - can start immediately
