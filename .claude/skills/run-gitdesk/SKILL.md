---
name: run-gitdesk
description: Build, run, drive, and screenshot GitDesk (Electron + React Git client). Use when asked to run/start/launch the app, take a screenshot, click through the UI (stage, commit, etc.), or confirm a UI change works in the real app.
---

# Run GitDesk

Electron app. The driver is `scripts/capture.cjs`: it launches the built app, runs an optional JS flow in the page, saves a PNG of the app window only, and quits. Paths are relative to the repo root. Verified on macOS (Node 22, Electron 44); a headless Linux container was not tried.

## Build

```bash
npm install        # postinstall rebuilds node-pty
npm run build      # electron-vite -> out/ (capture.cjs loads out/main/index.js)
```

Rebuild after every source change; the driver runs the built `out/`, not the sources.

## Run (agent path)

```bash
E=node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
git init -q -b main /tmp/demo && (cd /tmp/demo && echo hi>a.txt && git add . && git commit -qm first && echo more>>a.txt && echo new>b.txt)

# screenshot only
$E scripts/capture.cjs --repo=/tmp/demo --out=/tmp/gitdesk.png

# drive the UI, then screenshot
$E scripts/capture.cjs --repo=/tmp/demo --out=/tmp/after.png --script=scripts/e2e/flow-commit.js
git -C /tmp/demo log --oneline     # shows "commit from driver"
```

Options: `--wait=<ms>` (settle time, default 2500), `--user-data=<dir>` (default: fresh temp dir, so the real settings are never touched and it runs alongside an open GitDesk).

Flow scripts are the body of an async function run in the page. Helpers: `sleep(ms)`, `find(selector, textPrefix?)`, `click(selector, textPrefix?)`, `type(selector, value)` (works with React inputs). The return value is printed as `script result: ...`. See `scripts/e2e/flow-commit.js`; `npm run e2e` runs it as a pass/fail smoke test (`scripts/e2e/smoke.cjs`).

Useful selectors: `.wip-label` (WIP row in the graph, opens the Changes panel), `.changes-panel .heading-actions button` ("Stage all" / "Discard all"), `.commit-box textarea`, `.commit-actions button` ("Commit N files"). Button text is i18n (`src/renderer/src/i18n/en.ts`).

Read the PNG afterwards to confirm it isn't blank. The screenshot is 2x (2560x1600).

## Run (human path)

`npm run dev` (hot reload) or `$E . --repo=/path`; opens a window and waits forever. Useless headless.

## Test

```bash
npm test && npm run typecheck   # 328 tests, real git in temp repos, ~15s
```

## Gotchas

- Changes panel is not visible at start: click `.wip-label` first, or `.changes-panel` won't exist (`not found: .changes-panel ...`).
- Commit button text includes the file count ("Commit 2 files"), so match by prefix `'Commit'`.
- `timeout` does not exist on macOS; don't wrap the driver in it.
- Only one instance runs per userData dir; the driver's temp `--user-data` avoids the single-instance lock.

## Troubleshooting

- `capture failed: not found: <selector>` -> the UI isn't in the state your flow assumed; take a plain screenshot first and inspect it.
- Stale UI after a code change -> you forgot `npm run build`.
