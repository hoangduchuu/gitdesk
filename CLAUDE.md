# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GitDesk is a local-first desktop Git client (Electron + React + TypeScript, built with electron-vite). Node 24 is the documented requirement (`fnm use 24`); `git` must be on PATH.

## Commands

```bash
npm install
npm run dev                        # hot-reload dev mode
npm run build                      # electron-vite build -> out/
npm test                           # vitest, all of tests/**/*.test.ts
npx vitest run tests/stash.test.ts # single file; add -t "name" for a single test
npm run typecheck                  # tsc --noEmit
npm run lint                       # Biome lint only (formatter off); errors fail, warnings are known debt
npm run package                    # macOS app in dist/mac-arm64/GitDesk.app
npm run release -- [patch|minor|major|x.y.z] [--notes "..."] [--yes]   # see scripts/release.sh; needs clean, synced tree and `gh`
```

Run the built app on a repo: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --repo=/path`. For driving/screenshotting the UI see the `run-gitdesk` skill (`.claude/skills/run-gitdesk/`), which wraps `scripts/capture.cjs`. It runs the built `out/`, so rebuild after source changes.

`postinstall` restores the executable bit on node-pty's `spawn-helper` (otherwise terminals fail with `posix_spawnp failed`).

## Architecture

Three-process split, with the IPC contract in `src/shared/api.ts` as the hub:

- **`src/main/`** – Git runs through the installed `git` CLI, never a library. `git/exec.ts` `runGit` uses `execFile` (no shell, prompts disabled); each file in `src/main/git/` wraps one area (status, log, diff, branches, remote, stash, conflict, rebase, gitflow, ...). `handlers.ts` implements the API and **validates every argument from the renderer** (`validate.ts`); `index.ts` creates the window, registers IPC, and keeps a repo allow-list. Other main-process services: profiles, credentials, avatars, terminal (node-pty), updater, publish, workspace (saved tabs).
- **`src/preload/`** – generates the `window.gitdesk` bridge from the `APP_METHODS` / `REPO_METHODS` lists in `src/shared/api.ts` (channel `gitdesk:<method>`). The renderer is sandboxed and can only reach main through it.
- **`src/renderer/src/`** – React UI. `Workspace.tsx` is the per-repo view (graph, changes, stash, sidebar), `App.tsx` the tab shell. Strings live in `i18n/en.ts` and `vi.ts`.
- **`src/shared/`** – types plus pure logic used by both sides and tested directly (graph lane layout, diff and conflict-marker parsers, partial-patch building).

Adding an API method touches several places: declare it on `GitDeskApi`, add it to `APP_METHODS` or `REPO_METHODS` (a compile-time check, `ALL_REPO_METHODS_LISTED`, fails if a repo method is missing), implement and validate it in `handlers.ts`, and call it via `renderer/src/api.ts`. Repo methods take the repo path as the first argument. Handlers return `Result<T>` rather than throwing across IPC.

Only one instance runs at a time (`requestSingleInstanceLock`); a second launch with `--repo=<path>` opens that repo in the running window.

## Tests

`tests/` uses real git in temporary repos (helpers in `tests/helpers/repo.ts`). `tests/helpers/setup.ts` overrides process env with `gitEnv` so the developer's own git config doesn't leak in; new tests that run git should go through those helpers.
