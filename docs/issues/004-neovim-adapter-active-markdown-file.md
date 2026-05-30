# Separate Neovim Session Mechanics From Active Markdown File Behavior

Type: AFK
Label: needs-triage

## What to build

Split Rust behavior so the Neovim session adapter owns PTY/RPC mechanics, while Active Markdown File behavior owns classifying and reading the current Neovim buffer as a Markdown File inside the Root Folder.

This is a behavior-preserving refactor. The existing Tauri commands should keep their external names and payload shapes. The end state should make it possible to test Active Markdown File behavior with a fake Neovim adapter rather than requiring a real Neovim process.

## Acceptance criteria

- [ ] `start_neovim`, `stop_neovim`, `write_to_neovim`, and `resize_neovim` preserve current behavior and error messages.
- [ ] Active Markdown File classification still rejects empty buffers, non-Markdown buffers, and Markdown files outside the Root Folder.
- [ ] Active Markdown File reads still use Neovim buffer content rather than disk content.
- [ ] Tests cover Active Markdown File behavior through a replaceable adapter or equivalent seam without starting Neovim.
- [ ] Existing `cargo test` passes.

## Blocked by

- `docs/issues/003-root-folder-markdown-files-module.md`
