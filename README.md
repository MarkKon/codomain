# Codomain

Codomain is a Tauri desktop app that binds each window to a root folder, runs a real Neovim process in that folder, and renders the active Markdown buffer beside it.

## Run

Cargo is expected at `/Users/kmark/.cargo/bin` in this environment, so prepend it when running through npm:

```sh
PATH="/Users/kmark/.cargo/bin:$PATH" npm run tauri:dev -- /path/to/root
```

Build the macOS app bundle:

```sh
PATH="/Users/kmark/.cargo/bin:$PATH" npm run tauri:build
```

The release build writes the app bundle and DMG:

```text
src-tauri/target/release/bundle/macos/Codomain.app
src-tauri/target/release/bundle/dmg/
```

You can also run the built binary directly from any folder:

```sh
src-tauri/target/release/codomain .
```

## Release

Pushing a `v*` tag builds and publishes an unsigned universal macOS DMG through GitHub Actions.
The same workflow updates the Homebrew cask in `MarkKon/homebrew-codomain`.
See `docs/release/dmg.md` and `docs/release/homebrew.md` for the release checklist.

## Controls

- `Ctrl+1`: Neovim full view
- `Ctrl+2`: split view
- `Ctrl+3`: Markdown full view
- `NV`, `SP`, `MD`: toolbar buttons for the same view modes

## Current Behavior

- The left pane is an xterm.js terminal connected to a real PTY-backed `nvim` process.
- Neovim starts with `--listen` so the app can query the active buffer.
- The right pane refreshes from the current Neovim buffer when that buffer is a Markdown file under the root.
- `[[Note]]`, `[[folder/Note]]`, and `[[Note|Label]]` links navigate inside the root folder.
- Files outside the root are rejected by the backend.
