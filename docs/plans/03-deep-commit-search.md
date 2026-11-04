# 3. Deep commit search

## Problem
Cmd/Ctrl+F in `CommitGraph.tsx` filters the already-loaded rows (`searchText(row.node)`); the log is capped at `LOG_LIMIT` (`hooks/useRepository.ts`; server max 50 000). Older commits, and searches by changed file or code content, are not found.

## Design
- Server-side search: `git log --all --exclude=refs/stash --format=... ` with one of `--grep=<q> -i`, `--author=<q>`, `-S<q>` (pickaxe: added/removed string), or `-- <path>` (touched file). Reuse `readCommits(repo, selection)`.
- API: `searchCommits(repo, { mode: 'message'|'author'|'content'|'path', query, limit })` returning `Commit[]`; validate mode against a whitelist and cap query length. Pass the query as a single argv element (`--grep=${q}`); use `--fixed-strings` for message/author unless a regex mode is added.
- UI: extend the existing search bar with a mode selector. Message/author/hash stay local and instant; content/path modes call the API (debounced) and show matches by highlighting/jumping to rows. If a result is not in the loaded rows, offer "Load more history" or show it in a result list that selects it via `revealCommit`.

## Status
Steps 1-4 done. Cmd/Ctrl+F has a scope selector (Loaded commits, Message, Author, Code changes, File or folder). Whole-history scopes call `searchCommits` after a 400 ms pause (max 300 results); matches in the graph are highlighted and navigable as before, and results older than the loaded history (`LOG_LIMIT` = 5000) are listed above the graph and open in the details panel. Not done: cancelling a slow `-S` search (a late answer for old text is ignored, but git keeps running; `runGit` has no abort signal). Path scope is an exact file or folder, not a substring or glob.

## Steps
1. **Git layer + tests** `src/main/git/search.ts`: message, author, `-S`, path modes; special characters in the query are literal; no results -> `[]`.
2. **API + validation + handler tests.**
3. **UI**: mode dropdown, debounced call, result navigation (next/prev reuses the existing match index logic), i18n en+vi, screenshot via `run-gitdesk` (create repo with a distinctive string in an old commit, search it).
4. Beyond-limit behaviour: results outside loaded rows open in a list.

## Risks
- `-S` over a huge history is slow: cap with `--max-count`, run off the UI path, show a spinner, and allow cancel (kill the child; check whether `runGit` exposes an abort signal, else add one).
