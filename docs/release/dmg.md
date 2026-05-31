# DMG Releases

Codomain is currently distributed as a macOS DMG.

## Local Build

```sh
PATH="$HOME/.cargo/bin:$PATH" npm run tauri:build
```

The DMG is written to:

```text
src-tauri/target/release/bundle/dmg/
```

## GitHub Release And Homebrew

1. Update the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit the version bump.
3. Tag the release:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

Pushing a `v*` tag runs `.github/workflows/release.yml`, builds a universal macOS DMG, attaches it to a GitHub Release, and updates the Homebrew cask in `MarkKon/homebrew-codomain`.

See `docs/release/homebrew.md` for Homebrew setup and release operations.

## Neovim

Codomain intentionally does not install or bundle Neovim. Users should install and configure Neovim themselves so the app runs against their local Neovim setup.

At launch, the app looks for Neovim in this order:

1. `CODOMAIN_NVIM`
2. `/opt/homebrew/bin/nvim`
3. `/usr/local/bin/nvim`
4. `/usr/bin/nvim`
5. `nvim` on `PATH`

For early releases, tell users they need a working local Neovim installation. If Neovim is not in one of the standard locations, they can point Codomain at it with:

```sh
export CODOMAIN_NVIM=/path/to/nvim
```
