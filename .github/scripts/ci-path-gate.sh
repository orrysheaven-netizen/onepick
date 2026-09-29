#!/usr/bin/env bash
# Decide whether a required CI job needs to run its heavy steps for a PR.
#
# Reads changed file paths (one per line) on stdin and prints "true" when the
# heavy job must run, "false" when every changed file is unrelated.
#
#   ci-path-gate.sh --pattern '<ERE>' [--referenced-in <dir>]... < changed-files
#
# --pattern        Extended regex matched against each changed path.
# --referenced-in  Also run when a changed path appears literally inside any file
#                  under <dir> (tests that read repo files such as docs/*.md).
#
# Fail-safe: an empty or unreadable file list prints "true". Changes to this
# script (or its tests) always print "true" so every gated workflow re-validates itself.
set -euo pipefail

pattern=""
referenced_dirs=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pattern) pattern="${2:?--pattern needs a value}"; shift 2 ;;
    --referenced-in) referenced_dirs+=("${2:?--referenced-in needs a value}"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$pattern" ] || { echo "--pattern is required" >&2; exit 2; }

files=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [ -n "$line" ] && files+=("$line")
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "no changed files reported; running heavy steps (fail-safe)" >&2
  echo true
  exit 0
fi

for file in "${files[@]}"; do
  if [ "$file" = ".github/scripts/ci-path-gate.sh" ] || [ "$file" = ".github/scripts/test-ci-path-gate.sh" ]; then
    echo "gate script changed: $file" >&2
    echo true
    exit 0
  fi
  if printf '%s\n' "$file" | grep -Eq -- "$pattern"; then
    echo "relevant change: $file" >&2
    echo true
    exit 0
  fi
  for dir in "${referenced_dirs[@]}"; do
    if [ -d "$dir" ] && grep -rqF -- "$file" "$dir"; then
      echo "changed file is read by $dir: $file" >&2
      echo true
      exit 0
    fi
  done
done

echo "no relevant changes in ${#files[@]} file(s); heavy steps skipped" >&2
echo false
