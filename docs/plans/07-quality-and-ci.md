# 7. Code quality and CI

Currently: `tsc --noEmit` and vitest only; no linter, no `.github/`, no automated UI check. Releases are built locally (`scripts/release.sh`).

## Steps
1. **Lint.** Add Biome (single dev dependency, fast, formatting + lint) or ESLint + typescript-eslint. Start with the recommended rules, fix or disable noisy ones in the config rather than reformatting the whole repo in one commit; add `npm run lint`. Update `CLAUDE.md` commands.
2. **CI workflow** `.github/workflows/ci.yml`: macOS runner (the app and `capture.cjs` are mac-oriented), Node from `.nvmrc`/package engines, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Note the `postinstall` chmod of node-pty's `spawn-helper`.
3. **UI smoke test** built on `scripts/capture.cjs`: a script that creates a temp repo, runs `.claude/skills/run-gitdesk/flow-commit.js`, asserts `git log` contains the commit and the PNG is non-blank (size/entropy check), exit code non-zero on failure. Run in CI on macOS with `--user-data` temp dir. Move the flow next to the script (`scripts/e2e/`) and update the `run-gitdesk` SKILL.md paths when graduating it.
4. **Engines pin.** README says Node 24 but dev machine here ran Node 22.14 and everything passed; verify which is actually required, then add `engines` and a version file so CI and docs agree.

## Risks
- GitHub macOS runners have no display session guarantees; `capturePage` with `stayHidden` worked locally: confirm on a runner before making the check required.
