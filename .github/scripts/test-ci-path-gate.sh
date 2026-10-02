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

# --- Workflow-level gate (#576 M1) ---------------------------------------------------
# The gate script runs from the base commit, and control-plane changes force the heavy
# job inline. Replay each workflow's real gate step against a gate script replaced by
# `echo false` (what a hostile PR would submit): control-plane changes must still run.
# Requires python3 with PyYAML (to read the step from the workflow).
gate_step() { # <workflow> <files...>
  local wf_file="$1"; shift
  local tmp; tmp="$(mktemp -d)"
  mkdir -p "$tmp/bin" "$tmp/.github/scripts" "$tmp/mobile/scripts"
  printf '%s\n' "$@" > "$tmp/files.txt"
  printf '#!/usr/bin/env bash\ncat "%s/files.txt"\n' "$tmp" > "$tmp/bin/gh"
  chmod +x "$tmp/bin/gh"
  printf 'echo false\n' > "$tmp/.github/scripts/ci-path-gate.sh"
  python3 - "$wf/$wf_file" > "$tmp/step.sh" <<'PY'
import sys, yaml
jobs = yaml.safe_load(open(sys.argv[1]))["jobs"]
print(next(s for s in jobs["changes"]["steps"] if s.get("id") == "gate")["run"])
PY
  (cd "$tmp" && PATH="$tmp/bin:$PATH" RUNNER_TEMP="$tmp" GITHUB_OUTPUT="$tmp/out" \
     REPOSITORY=owner/repo PR_NUMBER=1 bash step.sh >/dev/null 2>&1) || true
  sed -n 's/^run=//p' "$tmp/out" 2>/dev/null
  rm -rf "$tmp"
}

expect_step() { # <label> <expected> <files...>
  local label="$1" want="$2"; shift 2
  local wf_file got
  for wf_file in database-tests.yml mobile-ci.yml web-build.yml; do
    got="$(gate_step "$wf_file" "$@")"
    if [ "$got" = "$want" ]; then
      echo "ok   [$wf_file] $label -> run=$got"
    else
      echo "FAIL [$wf_file] $label -> run=${got:-<none>} (expected $want)"
      fail=1
    fi
  done
}

expect_step "Hostile gate + gate script change"  true  .github/scripts/ci-path-gate.sh mobile/src/app/index.tsx
expect_step "Hostile gate + gate test change"    true  .github/scripts/test-ci-path-gate.sh
expect_step "Hostile gate + any workflow change" true  .github/workflows/ai-handoff-claude.yml
expect_step "Hostile gate + other script"        true  .github/scripts/test-pm-review-queue.sh
expect_step "Unrelated docs reach the gate"      false docs/pm/README.md

for wf_file in database-tests.yml mobile-ci.yml web-build.yml; do
  if python3 - "$wf/$wf_file" <<'PY'
import sys, yaml
jobs = yaml.safe_load(open(sys.argv[1]))["jobs"]
checkout = next(s for s in jobs["changes"]["steps"] if str(s.get("uses", "")).startswith("actions/checkout"))
sys.exit(0 if checkout.get("with", {}).get("ref") == "${{ github.event.pull_request.base.sha }}" else 1)
PY
  then echo "ok   [$wf_file] gate script checked out from the base commit"
  else echo "FAIL [$wf_file] gate script is not checked out from the base commit"; fail=1
  fi
done

# Required success steps run before checkout on unrelated PRs. Jobs with a
# default working-directory (mobile) must override that step back to repo root,
# otherwise the runner fails before it can report the required check as success.
for wf_file in mobile-ci.yml web-build.yml; do
  if python3 - "$wf/$wf_file" <<'PY'
import sys, yaml
jobs = yaml.safe_load(open(sys.argv[1]))["jobs"]
job_name = "typecheck" if sys.argv[1].endswith("mobile-ci.yml") else "verify-web"
steps = jobs[job_name]["steps"]
step = next(s for s in steps if s.get("name") == "Required check satisfied")
sys.exit(0 if step.get("working-directory") == "." else 1)
PY
  then echo "ok   [$wf_file] unrelated required success step runs from repository root"
  else echo "FAIL [$wf_file] unrelated required success step inherits a missing pre-checkout working directory"; fail=1
  fi
done

exit "$fail"
