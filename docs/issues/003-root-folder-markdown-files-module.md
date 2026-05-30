# Deepen Root Folder Markdown Files Lookup

Type: AFK
Label: needs-triage

## What to build

Deepen the Rust Root Folder Markdown Files module so Root Folder safety, Markdown File reading, relative path conversion, and Wikilink Resolution are easier to change and test as one domain behavior.

This should be a behavior-preserving refactor. It should not introduce new product semantics for ambiguous Wikilinks, ignored folders, attachments, or caches. The goal is to concentrate the existing Root Folder and Markdown File invariants behind a clearer module seam before those features arrive.

## Acceptance criteria

- [ ] Root Folder path canonicalization, symlink escape rejection, absolute path rejection, Markdown File reads, and relative path reporting remain behaviorally unchanged.
- [ ] Wikilink Resolution for stem links, labeled links, anchored links, and relative nested links remains behaviorally unchanged.
- [ ] Rust tests cover the public Root Folder Markdown Files behavior rather than scattered helper details where practical.
- [ ] The module names and test names use `CONTEXT.md` vocabulary: Root Folder, Markdown File, and Wikilink Resolution.
- [ ] Existing `cargo test` passes.

## Blocked by

None - can start immediately
