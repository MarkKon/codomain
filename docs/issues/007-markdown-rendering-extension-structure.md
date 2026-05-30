# Organize Markdown Rendering Extensions Internally

Type: AFK
Label: needs-triage

## What to build

Keep the Markdown Rendering interface stable while organizing its implementation around Codomain syntax extensions. Math parsing, Wikilink token expansion, Obsidian image embeds, pipe sentinel handling, and renderer rules should become easier to navigate without changing rendered output.

This is an internal structure issue for a module that is already deep. It should be tackled after the runtime refactors or independently when a sub-agent is focused on Markdown Rendering.

## Acceptance criteria

- [ ] `createMarkdownRendering({ renderMath })` remains the caller-facing Markdown Rendering interface.
- [ ] Existing Markdown Rendering behavior remains unchanged for Markdown syntax, raw HTML escaping, Wikilinks, labeled Wikilinks, math, tables, code spans/fences, and Obsidian image embeds.
- [ ] Tests remain centered on Markdown Rendering output and include any new focused fixtures needed for moved extension code.
- [ ] The implementation is easier to navigate by Codomain syntax area without increasing caller knowledge.
- [ ] Existing `npm test` passes.

## Blocked by

None - can start immediately
