# GitDesk enhancement roadmap

Each plan is implemented step by step; every step ends with `npm run typecheck && npm test` green and, for UI steps, a screenshot via the `run-gitdesk` skill. One commit per step.

| # | Plan | Why | Size |
|---|---|---|---|
| 1 | [Reflog and undo](01-reflog-undo.md) | Safety net for reset --hard, discard, rebase, force push | S-M |
| 2 | [File history and blame](02-file-history-blame.md) | Core "who changed this and why" workflow; none exists | M |
| 3 | [Deep commit search](03-deep-commit-search.md) | Current Cmd+F only searches the commits already loaded (`LOG_LIMIT`) | S |
| 4 | [Pull requests](04-pull-requests.md) | Reuses existing GitHub auth and publish code | M |
| 5 | [Signed commits](05-signed-commits.md) | Profile option + verified badge | M |
| 6 | [Worktrees and submodules](06-submodules-worktrees.md) | Neither exists today | M each |
| 7 | [Quality and CI](07-quality-and-ci.md) | No linter, no CI, no UI smoke test | S |
| 8 | [Distribution](08-distribution.md) | Signing/notarization, Intel, Windows/Linux | L |

Not planned yet: bisect.

## Conventions every plan follows

- **New git operation** = a file in `src/main/git/` (pure function over `runGit`) + a vitest suite using `tests/helpers/repo.ts`.
- **New API method** = declare on `GitDeskApi` and list in `REPO_METHODS` (`src/shared/api.ts`), implement with argument validation in `src/main/handlers.ts` (add `require*` helpers in `src/main/validate.ts`), add a handler test in `tests/handlers.test.ts`.
- Pure parsing/formatting goes in `src/shared/` so it is unit-testable without git.
- All user-visible strings go into both `i18n/en.ts` and `i18n/vi.ts` (there is an i18n test that likely checks parity; run it).
- Git args: never interpolate; pass `--` before user-supplied paths; validate hashes with `requireHash`.
