# 5. Signed commits

## Goal
Per-profile option to sign commits (SSH or GPG key) and show a verified/unverified badge in the commit panel.

## Design
- Profile (`src/shared/model.ts`, stored by `src/main/profiles.ts`) currently has only `{ id, name, email }`. Add optional `signing?: { format: 'ssh' | 'openpgp'; key: string }`. Migration: absent field = no signing; existing `profiles.json` must still load (`tests/profiles.test.ts`).
- Commit: where `commit()` in `src/main/git/worktree.ts` builds identity env/args, add `-c gpg.format=<f> -c user.signingkey=<key> -S` when the repo's selected profile has signing. Never pass the key through a shell; it is a single argv element.
- Verification badge: add `%G?` to log formats (careful: `FORMAT` in `log.ts` is positional, and `FIELDS_BEFORE_BODY` must be updated) or fetch lazily in `getCommitDetails` to avoid slowing the whole graph. Prefer lazy.
- Failures: signing needs an agent/pinentry; with prompts disabled (`runGit`) it fails fast. Surface git's stderr and suggest `ssh-add`.

## Steps
1. Profile model + persistence + migration test.
2. Commit with signing + test using an SSH key generated in the test (`ssh-keygen -t ed25519 -N ""`) and `gpg.ssh.allowedSignersFile` for verification in the assertion (`git log --format=%G?` -> `G`).
3. Profile dialog fields (`ProfilesDialog.tsx`), i18n, validation (`validate.ts`: key length, no control chars).
4. Lazy verification status in commit details + badge in `CommitPanel.tsx`; screenshot.

## Risks
- GPG tests are brittle in CI; test SSH signing only, treat GPG as pass-through.
- Rewording/rebasing re-creates commits: check `reword.ts`/`rebase.ts` keep signing (git re-signs with `commit.gpgsign=true`; otherwise they silently become unsigned). Decide whether to set `-c commit.gpgsign=true` for those flows.
