# 4. Pull requests from the app

## Goal
List open PRs for the repo, create one for the current branch, and check out a PR locally. GitHub first; the provider layer should leave room for GitLab.

## Design
- Reuse what exists: `src/main/publish.ts` already calls the provider with a `ProviderAccess { host, username, token }` obtained from `Credentials.accessFor(profileId)` (token never reaches the renderer), with `REQUEST_TIMEOUT_MS` and an `explain(response)` error flattener. Put PR calls in `src/main/pullRequests.ts` next to it and share `send`/`explain` (extract if needed).
- Provider detection from the remote URL: `src/shared/remote-url.ts` already parses URLs; derive `{host, owner, repo}`.
- GitHub REST: `GET /repos/{o}/{r}/pulls?state=open`, `POST /repos/{o}/{r}/pulls {title, head, base, body}`. Checkout a PR = `git fetch origin pull/{n}/head:pr-{n}` then switch (no API needed).
- Types in `src/shared/model.ts`: `PullRequest { number, title, author, head, base, url, draft }`.
- UI: sidebar section "Pull requests" (beside Remotes/Tags/Stashes in `Sidebar.tsx`), a "Create pull request…" dialog (model on `PublishDialog.tsx`) from the branch context menu and after a push of a new branch.

## Steps
1. **Provider layer + tests** with an injected `fetch` (the `updater.ts` pattern `request: typeof fetch = fetch`), covering list, create, 422 error text, 401.
2. **API + validation** (`listPullRequests`, `createPullRequest`, `checkoutPullRequest`); handler tests; ensure the title/body length caps and that `head`/`base` are valid branch names.
3. **Sidebar list + open-in-browser** (use `shell.openExternal` only for https URLs on the profile's host).
4. **Create dialog**, prefilled from the branch's last commit subject; i18n en+vi; screenshot.
5. **Checkout PR** flow.

## Risks
- Needs the token to have PR scope; the GitHub device flow in `credentials.ts` may request a narrower scope: check the requested scopes first, and handle a 403 with a clear "reconnect profile" message.
- Can't be tested end to end without a real account; keep all logic behind the injected `fetch` and test with fixtures.
