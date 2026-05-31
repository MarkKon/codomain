# Homebrew Releases

Codomain uses a custom Homebrew tap:

```text
MarkKon/homebrew-codomain
```

Homebrew maps that repository to:

```sh
brew tap MarkKon/codomain
```

The cask lives at:

```text
Casks/codomain.rb
```

## User Install

```sh
brew tap MarkKon/codomain
brew install --cask codomain
```

Users can update with:

```sh
brew update
brew upgrade --cask codomain
```

Codomain does not install or bundle Neovim. Users are expected to install and configure Neovim themselves.

## Release Flow

1. Update the version in:

   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`

2. Commit the version bump.

3. Create and push a matching tag:

   ```sh
   git tag v0.1.1
   git push origin HEAD
   git push origin v0.1.1
   ```

4. GitHub Actions builds a universal macOS DMG, creates a GitHub Release, computes the DMG SHA256, and updates `MarkKon/homebrew-codomain`.

The release workflow builds with:

```sh
npm run tauri:build -- --target universal-apple-darwin
```

This produces one DMG for both Apple Silicon and Intel Macs. Tauri requires both Rust targets, so CI installs:

```text
aarch64-apple-darwin
x86_64-apple-darwin
```

## Tap Write Access

The app repository release workflow updates the tap through a write-enabled deploy key:

- Public key: installed on `MarkKon/homebrew-codomain`
- Private key: stored as the `TAP_DEPLOY_KEY` secret on `MarkKon/codomain`

If the key ever needs rotation:

```sh
ssh-keygen -t ed25519 -C "codomain-release-to-homebrew-tap" -f /tmp/codomain_tap_deploy_key -N ""
gh repo deploy-key add /tmp/codomain_tap_deploy_key.pub --repo MarkKon/homebrew-codomain --title codomain-release-workflow --allow-write
gh secret set TAP_DEPLOY_KEY --repo MarkKon/codomain < /tmp/codomain_tap_deploy_key
```
