#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ai-pm-dispatch.yml"
PM_QUEUE="$ROOT/.github/workflows/ai-pm-review-queue.yml"

checks=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { checks=$((checks + 1)); }

expect_contains() {
  local file="$1" needle="$2" label="$3"
  grep -Fq -- "$needle" "$file" || fail "$label"
  ok
}

expect_not_contains() {
  local file="$1" needle="$2" label="$3"
  if grep -Fq -- "$needle" "$file"; then fail "$label"; fi
  ok
}

parse_directive() {
  local line="$1"
  local re='^PM_DIRECTIVE: team=(product|ux|engineering|data|qa|release) assignee=(lead|claude) action=execute pr=(none|[1-9][0-9]*) head=(none|[0-9a-f]{40})$'
  [[ "$line" =~ $re ]] || return 1
  local pr="${BASH_REMATCH[3]}" head="${BASH_REMATCH[4]}"
  if { [ "$pr" = none ] && [ "$head" != none ]; } ||
     { [ "$pr" != none ] && [ "$head" = none ]; }; then
    return 1
  fi
  printf '%s\t%s\t%s\t%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$pr" "$head"
}

route() {
  local team="$1" assignee="$2" area lead_owner owner
  case "$team" in
    product|ux|engineering) area="area:app"; lead_owner="owner:codex" ;;
    data) area="area:data"; lead_owner="owner:codex" ;;
    qa) area="area:qa"; lead_owner="owner:claude" ;;
    release) area="area:infra"; lead_owner="owner:claude" ;;
    *) return 1 ;;
  esac
  if [ "$assignee" = claude ]; then owner="owner:claude"; else owner="$lead_owner"; fi
  printf '%s\t%s\n' "$owner" "$area"
}

expect_parse_ok() {
  parse_directive "$1" >/dev/null || fail "expected valid directive: $1"
  ok
}

expect_parse_fail() {
  if parse_directive "$1" >/dev/null 2>&1; then fail "expected invalid directive: $1"; fi
  ok
}

expect_route() {
  local got
  got="$(route "$1" "$2")"
  [ "$got" = "$3"$'\t'"$4" ] || fail "route $1/$2 -> $got"
  ok
}

expect_contains "$WORKFLOW" "PM_DIRECTIVE: team=<product|ux|engineering|data|qa|release> assignee=<lead|claude>" "canonical directive documented"
expect_contains "$WORKFLOW" "onepick-pm-dispatch:pending" "durable pending marker"
expect_contains "$WORKFLOW" "onepick-pm-dispatch:processed" "processed marker"
expect_contains "$WORKFLOW" "onepick-pm-assignment" "assignment marker"
expect_contains "$WORKFLOW" 'index("state:blocked") != null or index("state:active") != null' "blocked/active hold"
expect_contains "$WORKFLOW" 'state:ready' "ready assignment"
expect_contains "$WORKFLOW" 'state:review' "report review transition"
expect_contains "$WORKFLOW" 'PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none' "completion report PM routing"
expect_contains "$WORKFLOW" "issues:" "label wake event"
expect_contains "$WORKFLOW" "cancel-in-progress: false" "durable drain concurrency"

expect_not_contains "$WORKFLOW" "openai/codex-action" "no Codex API action"
expect_not_contains "$WORKFLOW" "anthropics/claude-code-action" "no Claude model action"
expect_not_contains "$WORKFLOW" "OPENAI_API_KEY" "no OpenAI API key"
expect_not_contains "$WORKFLOW" "CLAUDE_CODE_OAUTH_TOKEN" "no Claude OAuth execution"
expect_not_contains "$WORKFLOW" "runs-on: self-hosted" "no self-hosted/local runner"
expect_not_contains "$WORKFLOW" "ONEPICK_AI_HANDOFF_ENABLED" "assignment is independent from AI execution switch"
expect_not_contains "$PM_QUEUE" "vars.ONEPICK_AI_HANDOFF_ENABLED == 'true'" "PM review queue condition independent from AI execution switch"

sha="0123456789abcdef0123456789abcdef01234567"
expect_parse_ok "PM_DIRECTIVE: team=product assignee=lead action=execute pr=none head=none"
expect_parse_ok "PM_DIRECTIVE: team=engineering assignee=claude action=execute pr=580 head=$sha"
expect_parse_ok "PM_DIRECTIVE: team=release assignee=lead action=execute pr=12 head=$sha"
expect_parse_fail " PM_DIRECTIVE: team=product assignee=lead action=execute pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=unknown assignee=lead action=execute pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=data assignee=codex action=execute pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=7 head=none"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=none head=$sha"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=01 head=$sha"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=1 head=ABCDEF"

expect_route product lead owner:codex area:app
expect_route ux lead owner:codex area:app
expect_route engineering lead owner:codex area:app
expect_route data lead owner:codex area:data
expect_route qa lead owner:claude area:qa
expect_route release lead owner:claude area:infra
expect_route product claude owner:claude area:app
expect_route data claude owner:claude area:data
expect_route release claude owner:claude area:infra

echo "pm assignment dispatcher contract checks passed: $checks"
