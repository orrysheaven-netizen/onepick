#!/usr/bin/env bash
# Vercel "Ignored Build Step" for OnePick (wired up as ignoreCommand in vercel.json).
# Exit 0 = skip this deployment, exit 1 = build it.
#
# - Production (main) always builds.
# - Preview builds only when a changed file can affect the web build.
#   Changes limited to docs, Markdown, GitHub config and supabase/** are skipped.
# - A commit message containing "[vercel deploy]" forces a preview.
# - Whenever the changed files cannot be determined, it builds (fail open).
# Policy and verification notes: docs/vercel-preview-policy.md

set -u

build() { echo "vercel-ignore-build: BUILD - $1"; exit 1; }
skip() { echo "vercel-ignore-build: SKIP - $1"; exit 0; }

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ]; then
  build "production deployment"
fi

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[vercel deploy]"*) build "forced by [vercel deploy] in commit message" ;;
esac

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || build "not inside a git checkout"

# Compare against the last deployed commit of this branch; otherwise the branch
# point from main; otherwise just the latest commit.
base=""
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$prev" ] && git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  base="$prev"
elif git fetch --quiet --depth=100 origin main 2>/dev/null \
  && mb="$(git merge-base HEAD FETCH_HEAD 2>/dev/null)"; then
  base="$mb"
elif git cat-file -e "HEAD~1^{commit}" 2>/dev/null; then
  base="HEAD~1"
else
  build "no base commit to compare against"
fi

changed="$(git diff --name-only "$base" HEAD)" || build "git diff against $base failed"
[ -n "$changed" ] || skip "no file changes since $base"

while IFS= read -r file; do
  case "$file" in
    supabase/*|docs/*|.github/*|*.md) ;;
    *) build "$file affects the web build (base $base)" ;;
  esac
done <<EOF
$changed
EOF

skip "only docs/supabase/.github/Markdown changed since $base"
