# Local Install

Codomain is currently intended for local use by the repository owner. The install flow builds the
Tauri app bundle, copies it into the user's Applications folder, and links the bundled shell
launcher into `~/.local/bin`.

## Install

```sh
npm run install:local
```

The script installs:

```text
~/Applications/Codomain.app
~/.local/bin/codomain
```

Use Finder or Launchpad to open the app directly. Use the shell launcher to open a specific root:

```sh
codomain .
codomain ~/notes
```

## Local Signing

By default, the installer applies an ad-hoc local signature after copying the app. For a more stable
local privacy identity, create a local code-signing certificate in Keychain Access and pass its name:

```sh
CODOMAIN_CODESIGN_IDENTITY="Codomain Local Signing" npm run install:local
```

This is not a public distribution signature and does not notarize the app. It is only meant to make
the app identity more stable on your own Mac.

## Custom Install Locations

```sh
CODOMAIN_APP_DIR="$HOME/Applications" CODOMAIN_BIN_DIR="$HOME/.local/bin" npm run install:local
```
