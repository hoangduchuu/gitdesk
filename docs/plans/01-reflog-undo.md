# 1. Reflog and undo

## Goal
Let the user see where HEAD (and each branch) has been, and recover from a bad reset, rebase, amend or branch delete in two clicks.

## Design
- Data: `git reflog --format=%H%x1f%gd%x1f%gs%x1f%ct` (HEAD by default; optional ref argument). Entry = `{ hash, selector (HEAD@{n}), action (%gs, e.g. "reset: moving to X"), time }`.
- UI: a "Reflog" panel reachable from the toolbar (next to Stash/Pop) as a list; each row has context-menu actions: **Checkout** (detached), **Create branch here**, **Reset current branch to here** (reuse existing reset confirm flow), **Copy SHA**. Reuse `actions.ts` where possible (`promptCreateBranch`, `reset`, `checkoutCommit` already take a hash).
- "Undo last action" = convenience button resetting `--keep`... decision deferred: first ship the list, then add undo as step 4 only if the list proves clunky (undo semantics for rebase/merge are subtle).

## Status
Steps 1-5 done. Step 5: an "Undo last action" button in the reflog view takes back the newest commit (changes stay staged), reset (`--keep`, refuses if local changes are in the way) or branch switch; anything else is refused (`src/main/git/undo.ts`, `src/shared/undo.ts`).

## Steps
1. **Git layer + tests.** `src/main/git/reflog.ts` exporting `readReflog(repo, limit)`; parse with `\x1f` like `log.ts`. Types `ReflogEntry` in `src/shared/model.ts`. Tests: after commit/reset/checkout the expected entries and order; empty repo (unborn HEAD) returns `[]`.
2. **API.** `getReflog(repo, limit)` in `api.ts` + `REPO_METHODS`, handler with `requireInteger` bounds, handler test.
3. **UI.** `components/ReflogPanel.tsx`, toolbar button, i18n (en+vi), row context menu reusing existing actions. Screenshot: make a commit, `reset --hard HEAD~1`, open the panel, see the lost commit.
4. **Recover flow check** (end to end via `run-gitdesk` driver): reset --hard, open reflog, "Create branch here" on the lost commit, verify the branch exists with `git branch`.
5. (Optional) Undo button, scoped to reset/commit/checkout entries only.

## Risks / open questions
- Reflog entries for commits unreachable from any ref are not shown by the graph; after "Create branch here" they reappear, so refresh the repo data after the action.
- Reflog expires (default 90 days / 30 unreachable); note this in empty-state copy.
