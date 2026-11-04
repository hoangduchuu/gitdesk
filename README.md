# GitDesk

Local-first desktop Git client (Electron + React + TypeScript). Git runs through the
installed `git` CLI in the main process; the renderer is sandboxed and reaches it only
through the typed preload API (`window.gitdesk`).

## Install (macOS, Apple Silicon)

GitDesk is not signed with an Apple Developer ID, so macOS Gatekeeper will warn on a normal download.

**Option 1 - one command (recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/hoangduchuu/gitdesk/develop/install.sh | bash
```

**Option 2 - manual**

1. Download `GitDesk-<version>-arm64.dmg` from [Releases](https://github.com/hoangduchuu/gitdesk/releases/latest).
2. Open it and drag **GitDesk** into **Applications**.
3. Opening it the first time is blocked. Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to GitDesk. Or run:
   ```bash
   xattr -cr /Applications/GitDesk.app
   ```

Requires `git` on PATH.

## Building a release

```bash
npm run dist       # produces dist/GitDesk-<version>-arm64.dmg
gh release create v<version> dist/GitDesk-<version>-arm64.dmg --title "GitDesk <version>"
```

## Requirements

- Node.js 24 (`fnm use 24`)
- `git` on PATH

## Commands

```bash
npm install
npm run dev        # dev mode with hot reload; open a repo with the button
npm test           # unit + integration tests (creates temporary git repos)
npm run typecheck
npm run build      # production build into out/
npm run package    # macOS app into dist/mac-arm64/GitDesk.app
```

Open a repository directly from the command line after building:

```bash
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --repo=/path/to/repo
```

Capture a PNG of the app window (development check, macOS):

```bash
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/capture.cjs --repo=/path/to/repo --out=/tmp/gitdesk.png
```

## Features

- Commit graph with branch lanes, refs, tags and a working-changes row
- Changes: stage/unstage/discard per file or all, diff view, commit and amend
- Branches: create (also from any commit), checkout (remote branches become tracking branches), merge, delete; fetch, pull, push (publishes new branches with upstream)
- Stash: list, stash with message (optionally untracked files), apply/pop/drop any stash, view stashed files and diffs
- Conflicts: banner for merge/rebase/cherry-pick/revert in progress, resolve per conflict block (current, incoming, both) or edit the result by hand, take a whole side, continue or abort

## Layout

| Path | Role |
|---|---|
| `src/main/git/` | git CLI wrappers: `status`, `log`, `diff`, `worktree`, `branches`, `remote`, `stash`, `conflict` |
| `src/main/handlers.ts` | IPC handlers; validates every argument from the renderer |
| `src/main/index.ts` | window, IPC registration, repo allow-list |
| `src/preload/` | `contextBridge` API generated from `src/shared/api.ts` |
| `src/shared/` | types, graph lane layout, diff and conflict-marker parsers |
| `src/renderer/` | React UI |
| `tests/` | vitest suites (real git in temporary repos) |
| `scripts/capture.cjs` | dev tool: drive the built app and save a PNG of its window |
