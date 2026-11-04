#!/usr/bin/env bash
# Build the dmg and publish a new GitHub release.
#
# Usage: npm run release -- [patch|minor|major|<x.y.z>] [--notes "text"] [--yes]
#   default bump is "patch". Notes default to GitHub's auto-generated ones.
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="patch"
NOTES=""
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) NOTES="${2:?--notes needs a value}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) BUMP="$1"; shift ;;
  esac
done

die() { echo "✗ $*" >&2; exit 1; }

command -v gh >/dev/null || die "GitHub CLI (gh) is required: brew install gh"
gh auth status >/dev/null 2>&1 || die "Not logged in to GitHub. Run: gh auth login"
[ -z "$(git status --porcelain)" ] || die "Working tree is not clean. Commit or stash your changes first."

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
BRANCH="$(git branch --show-current)"
DEFAULT="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
[ "$BRANCH" = "$DEFAULT" ] || die "Release from '$DEFAULT' (you are on '$BRANCH')."

# Credentials for this script only; does not touch your git config.
GIT_PUSH=(git -c credential.helper= -c credential.helper='!gh auth git-credential')
"${GIT_PUSH[@]}" fetch -q origin "$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] \
  || die "Local $BRANCH differs from origin/$BRANCH. Pull or push first."

OLD="$(node -p "require('./package.json').version")"
npm version "$BUMP" --no-git-tag-version >/dev/null
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
rollback() { git checkout -q -- package.json package-lock.json; }

gh release view "$TAG" >/dev/null 2>&1 && { rollback; die "Release $TAG already exists."; }

echo "Release $REPO: $OLD → $VERSION (tag $TAG, branch $BRANCH)"
if [ "$YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " ok
  [ "$ok" = "y" ] || [ "$ok" = "Y" ] || { rollback; die "Cancelled."; }
fi

echo "→ Checks"
npm run typecheck --silent || { rollback; die "Typecheck failed."; }
npm test --silent || { rollback; die "Tests failed."; }

echo "→ Building dmg"
rm -f dist/*.dmg dist/*.blockmap
npm run dist --silent || { rollback; die "Build failed."; }
DMG="dist/GitDesk-$VERSION-arm64.dmg"
[ -f "$DMG" ] || { rollback; die "Expected $DMG was not produced."; }

echo "→ Committing and pushing"
git add package.json package-lock.json
git commit -q -m "Release $TAG"
"${GIT_PUSH[@]}" push -q origin "$BRANCH"

echo "→ Publishing release"
ARGS=("$TAG" "$DMG" --target "$(git rev-parse HEAD)" --title "GitDesk $VERSION")
if [ -n "$NOTES" ]; then ARGS+=(--notes "$NOTES"); else ARGS+=(--generate-notes); fi
gh release create "${ARGS[@]}"

echo "✓ Done: https://github.com/$REPO/releases/tag/$TAG"
