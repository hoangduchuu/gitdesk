# 8. Distribution: signing, notarization, more platforms

Current state (`package.json` `build`): mac, dmg, arm64 only; ad-hoc signed (`identity: "-"`, `hardenedRuntime: false`); `install.sh` and the README work around Gatekeeper; updater (`src/main/updater.ts`) downloads the newest dmg from GitHub releases and replaces the installed app; release via `scripts/release.sh`.

## A. Signing + notarization (needs Apple Developer account, paid)
1. Developer ID certificate in CI/keychain; set `identity`, `hardenedRuntime: true`, entitlements plist (node-pty needs `com.apple.security.cs.allow-unsigned-executable-memory`/JIT as Electron requires, verify by running).
2. Notarize with `notarytool` via electron-builder `notarize` config using an App Store Connect API key.
3. `asarUnpack` node-pty binaries must also be signed (electron-builder signs unpacked natives; verify with `codesign --verify --deep --strict`).
4. Drop the Gatekeeper workaround from the README/`install.sh` once verified on a clean Mac; keep the updater's replace-and-relaunch logic but test it against a signed build (replacing a signed app with a different signature can trigger prompts).

## B. Intel mac
Add `x64` (or `universal`) to the dmg arch list; `artifactName` already includes `${arch}`; the updater must pick the asset matching `process.arch` (check how `checkForUpdate` selects the asset). Rebuild node-pty per arch (`npmRebuild: false` is set today, so prebuilds must exist for both).

## C. Windows / Linux
Code already has partial hooks: `terminal.ts` handles `win32` shells, `index.ts` only applies the title-bar style on darwin. Missing: electron-builder targets (nsis/AppImage), `postinstall` is mac-specific (harmless elsewhere), updater/installer logic is bundle-replace for macOS only, `--repo` handling and single-instance should work unchanged, git path lookup and CRLF handling need tests, `capture.cjs` path in README is mac-only. Treat as a separate project after A and B; first run the app on Linux (`xvfb-run`) to find breakages cheaply.
