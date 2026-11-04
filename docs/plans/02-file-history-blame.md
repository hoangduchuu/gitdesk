# 2. File history and blame

## Goal
From any file (in Changes, in a commit's file list, or in a diff) open its history and a blame view.

## Design
- History: `git log --follow --format=<same FORMAT as log.ts> -- <path>`. Reuse `readCommits(repo, selection)` in `src/main/git/log.ts`, which already takes extra args: add `readFileHistory(repo, path, limit)` that passes `['--follow', `--max-count=${limit}`, '--', path]`. Note `--follow` only works for a single path.
- Blame: `git blame --porcelain [<rev>] -- <path>`. Parse into `BlameLine[] = { line, hash, author, time, summary, origPath }` in a **pure parser in `src/shared/blame-parse.ts`** (like `diff-parse.ts`) so it is unit-tested on fixtures. Porcelain only emits commit metadata the first time a hash appears; the parser must cache it.
- UI: new `center` kind in `Workspace.tsx` (alongside `diff` and `conflict`): `{ kind: 'history' | 'blame', path, rev }`. History view = commit list for the file; click a row -> existing `DiffView` with `{kind:'commit', hash, path}`. Blame view = file lines with a gutter (short hash, author, age); click gutter -> select that commit in the graph via `revealCommit`. Syntax highlighting: reuse `highlight.ts`.
- Entry points: file context menus in `FileList.tsx` / commit file list; "File history" and "Blame".

## Status
Plan complete (steps 1-6). Entry points: right-click a file in the Changes or commit panel; File history / Blame buttons in the diff header (not for stash or untracked files); "Blame at this commit" from the history view. Blame has syntax highlighting, click-to-show-in-graph and a 5000-line cap with a notice. History follows renames and returns the file's name at each commit so pre-rename diffs open correctly; blame uses `-M -C`.

## Steps
1. **Blame parser + tests** (`src/shared/blame-parse.ts`, `tests/blame-parse.test.ts`): multi-line same-commit groups, boundary commits (`^`), renamed file (`filename` header), uncommitted lines (all-zero hash).
2. **Git layer + tests.** `src/main/git/blame.ts` (`readBlame(repo, path, rev|null)`) and `readFileHistory` in `log.ts`. Tests with real repos: rename across history, blame after two authors' edits (use `git -c user.name`), binary file -> clear error.
3. **API + validation.** `getFileHistory`, `getBlame`; add `requireRepoPath`-style check that the path is relative and inside the repo (look at how `requireDiffTarget` validates paths and reuse it). Handler tests incl. `../` rejection.
4. **History view UI** + i18n + screenshot.
5. **Blame view UI** + i18n + screenshot; click-to-reveal commit.
6. Menu wiring in file lists; large-file guard (cap lines, e.g. 20k, show notice).

## Risks / open questions
- Large files: blame output can be big; stream-parse or cap.
- `--follow` is heuristic; document that history may stop at heavy rewrites.
