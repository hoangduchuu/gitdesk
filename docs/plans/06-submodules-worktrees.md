# 6. Submodules and worktrees

Grep found no mentions of either in `src/`. (`src/main/git/worktree.ts` is the *working tree* status/stage code, not `git worktree`.) Do worktrees first; they are simpler and more commonly used with feature branches.

## Status
A. Worktrees: done (parser, git layer with path/branch checks, API, sidebar section, "Worktree for this branch" in the branch menu, open in a new tab, remove with force confirm, prune). Also fixed: a prompt opened from another prompt's submit (new worktree, add remote) now starts with its own text instead of keeping the previous one. B. Submodules: not started.

## A. Worktrees
- Data: `git worktree list --porcelain` -> `{ path, head, branch|null, detached, locked, prunable }` (pure parser in `src/shared/`).
- Actions: add (`git worktree add [-b new] <path> <branch>`), remove (`remove [--force]`), prune, open in a new tab (tabs already exist: `openRecentRepo(path)`).
- UI: sidebar section "Worktrees"; "Create worktree for this branch…" in `branchMenu` (`actions.ts`).
- Steps: 1 parser+tests; 2 git layer (add/remove/list) + tests in temp repos (`tests/helpers/repo.ts`); 3 API+validation (path must be absolute, not inside `.git`); 4 sidebar + menu + i18n; 5 open-in-tab.
- Risk: removing a worktree with changes needs explicit confirm (reuse `ConfirmDialog`); the repo allow-list in `index.ts` must include a worktree path before it can be opened.

## B. Submodules
- Data: `git submodule status --recursive` + `.gitmodules` via `git config -f .gitmodules --list`; state per submodule: uninitialized, up to date, modified commit, dirty.
- Actions: init/update (`git submodule update --init --recursive`), open submodule as a tab, show in status (a modified submodule appears as a changed path today; check how `status.ts`/`diff` render a gitlink so it does not show a bogus text diff).
- Steps: 1 parser+tests; 2 git layer + tests (create a local "remote" repo as submodule source, no network); 3 API; 4 sidebar section; 5 gitlink-aware diff/status display; 6 clone with `--recurse-submodules` option in `CloneDialog.tsx` / `src/main/git/clone.ts`.
- Risk: `file://` submodule transport is blocked by default in recent git (`protocol.file.allow`); tests need `-c protocol.file.allow=always`.
