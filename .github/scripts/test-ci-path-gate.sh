#!/usr/bin/env bash
# Regression tests for ci-path-gate.sh using the same patterns as the CI workflows.
# Run from the repository root: bash .github/scripts/test-ci-path-gate.sh
set -euo pipefail

gate=".github/scripts/ci-path-gate.sh"
wf=".github/workflows"
fail=0

# Extract the --pattern argument each workflow passes to the gate, so the tests
# exercise the real patterns rather than a copy.
pattern_of() { grep -oE -- "--pattern '[^']+'" "$wf/$1" | sed -E "s/^--pattern '(.*)'$/\1/"; }
db_pat="$(pattern_of database-tests.yml)"
mobile_pat="$(pattern_of mobile-ci.yml)"
web_pat="$(pattern_of web-build.yml)"

run_gate() { # <name> <files...>
  local name="$1"; shift
  case "$name" in
    db) printf '%s\n' "$@" | bash "$gate" --pattern "$db_pat" 2>/dev/null ;;
    mobile) printf '%s\n' "$@" | bash "$gate" --pattern "$mobile_pat" --referenced-in mobile/scripts 2>/dev/null ;;
    web) printf '%s\n' "$@" | bash "$gate" --pattern "$web_pat" 2>/dev/null ;;
  esac
}

expect() { # <label> <db> <mobile> <web> <files...>
  local label="$1" db="$2" mobile="$3" web="$4"; shift 4
  local got_db got_mobile got_web
  got_db="$(run_gate db "$@")"; got_mobile="$(run_gate mobile "$@")"; got_web="$(run_gate web "$@")"
  if [ "$got_db $got_mobile $got_web" = "$db $mobile $web" ]; then
    echo "ok   $label -> db=$got_db mobile=$got_mobile web=$got_web"
  else
    echo "FAIL $label -> db=$got_db mobile=$got_mobile web=$got_web (expected db=$db mobile=$mobile web=$web)"
    fail=1
  fi
}

expect "DB migration only"            true  true  false supabase/migrations/20260929000000_x.sql
expect "DB pgTAP test only"           true  true  false supabase/tests/database/x.test.sql
expect "DB python tool only"          true  false false tools/sbiz_place_adapter.py
expect "Mobile screen only"           false true  true  mobile/src/app/index.tsx
expect "Mobile test script only"      false true  true  mobile/scripts/run-tests.cjs
expect "Edge Function only"           true  true  false supabase/functions/movie-catalog/index.ts
expect "QA tool only"                 false false true  tools/qa/daily-qa.mjs
expect "Docs only"                    false false false docs/pm/README.md
expect "Handoff docs only"            false false false docs/ai-role-division.md AGENTS.md CLAUDE.md
expect "Docs read by mobile tests"    false true  false docs/pokemon-catalog.md
expect "Handoff workflow only"        false false false .github/workflows/ai-handoff-claude.yml
expect "Database Tests workflow"      true  false false .github/workflows/database-tests.yml
expect "Mobile CI workflow"           false true  false .github/workflows/mobile-ci.yml
expect "Web build workflow"           false false true  .github/workflows/web-build.yml
expect "Gate script changed"          true  true  true  .github/scripts/ci-path-gate.sh
expect "Mixed docs + mobile"          false true  true  docs/x.md mobile/package.json
expect "Rename out of mobile"         false true  true  docs/moved.md mobile/old-name.md
expect "Gate tests changed"           true  true  true  .github/scripts/test-ci-path-gate.sh
expect "Empty list (fail-safe)"       true  true  true

exit "$fail"
