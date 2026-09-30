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
  local re='^PM_DIRECTIVE: team=(product|ux|engineering|data|qa|release) assignee=(auto|lead|claude) action=(execute|review) pr=(none|[1-9][0-9]*) head=(none|[0-9a-f]{40})$'
  [[ "$line" =~ $re ]] || return 1

  local pr="${BASH_REMATCH[4]}" head="${BASH_REMATCH[5]}"
  if { [ "$pr" = none ] && [ "$head" != none ]; } ||
     { [ "$pr" != none ] && [ "$head" = none ]; }; then
    return 1
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' \
    "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "$pr" "$head"
}

route() {
  local team="$1" assignee="$2" action="$3" current_owner="${4:-none}"
  local area resolved owner

  case "$team" in
    product|ux|engineering) area="area:app" ;;
    data) area="area:data" ;;
    qa) area="area:qa" ;;
    release) area="area:infra" ;;
    *) return 1 ;;
  esac

  resolved="$assignee"
  if [ "$assignee" = auto ]; then
    if [ "$action" = execute ]; then
      resolved=lead
    elif [ "$current_owner" = owner:claude ]; then
      resolved=lead
    else
      resolved=claude
    fi
  fi

  if [ "$resolved" = claude ]; then
    owner=owner:claude
  else
    owner=owner:codex
  fi

  printf '%s\t%s\t%s\n' "$resolved" "$owner" "$area"
}

expect_parse_ok() {
  parse_directive "$1" >/dev/null || fail "expected valid directive: $1"
  ok
}

expect_parse_fail() {
  if parse_directive "$1" >/dev/null 2>&1; then
    fail "expected invalid directive: $1"
  fi
  ok
}

expect_route() {
  local got
  got="$(route "$1" "$2" "$3" "$4")"
  [ "$got" = "$5"$'\t'"$6"$'\t'"$7" ] ||
    fail "route $1/$2/$3/$4 -> $got"
  ok
}

# Workflow contract and safety.
expect_contains "$WORKFLOW" "github.event.comment.user.login == github.repository_owner" "directive/report runner trust gate"
expect_contains "$WORKFLOW" "onepick-pm-dispatch:pending" "durable assignment pending marker"
expect_contains "$WORKFLOW" "onepick-pm-dispatch:processed" "assignment processed marker"
expect_contains "$WORKFLOW" "onepick-pm-assignment" "assignment result marker"
expect_contains "$WORKFLOW" "onepick-pm-report:pending" "durable report pending marker"
expect_contains "$WORKFLOW" "onepick-pm-report:processed" "report processed marker"
expect_contains "$WORKFLOW" "resolved=$resolved action=$action" "resolved executor and action persisted"
expect_contains "$WORKFLOW" 'index("state:blocked") != null or index("state:active") != null' "blocked/active assignment hold"
expect_contains "$WORKFLOW" 'index("state:blocked") != null' "blocked report hold"
expect_contains "$WORKFLOW" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none" "report routed to PM queue"
expect_contains "$WORKFLOW" "cancel-in-progress: false" "durable serialized drain"
expect_contains "$WORKFLOW" "state=open&per_page=100" "repository sweep recovery"
expect_contains "$WORKFLOW" ".user.login == $bot" "only bot-authored queue markers trusted"
expect_contains "$WORKFLOW" 'assignee=(?<assignee>auto|lead|claude)' "auto/lead/Claude marker parser"
expect_contains "$WORKFLOW" 'action=(?<action>execute|review)' "execute/review marker parser"

expect_not_contains "$WORKFLOW" "openai/codex-action" "no Codex API action"
expect_not_contains "$WORKFLOW" "anthropics/claude-code-action" "no Claude model action"
expect_not_contains "$WORKFLOW" "OPENAI_API_KEY" "no OpenAI API key"
expect_not_contains "$WORKFLOW" "CLAUDE_CODE_OAUTH_TOKEN" "no Claude OAuth execution"
expect_not_contains "$WORKFLOW" "runs-on: self-hosted" "no local/self-hosted runner"
expect_not_contains "$WORKFLOW" "vars.ONEPICK_AI_HANDOFF_ENABLED == 'true'" "dispatcher independent from AI switch"
expect_not_contains "$PM_QUEUE" "vars.ONEPICK_AI_HANDOFF_ENABLED == 'true'" "PM review queue independent from AI switch"

# Parser.
sha="0123456789abcdef0123456789abcdef01234567"
expect_parse_ok "PM_DIRECTIVE: team=product assignee=lead action=execute pr=none head=none"
expect_parse_ok "PM_DIRECTIVE: team=engineering assignee=claude action=execute pr=580 head=$sha"
expect_parse_ok "PM_DIRECTIVE: team=release assignee=auto action=review pr=12 head=$sha"
expect_parse_ok "PM_DIRECTIVE: team=qa assignee=auto action=execute pr=none head=none"

expect_parse_fail " PM_DIRECTIVE: team=product assignee=lead action=execute pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=unknown assignee=lead action=execute pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=data assignee=codex action=execute pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=plan pr=none head=none"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=7 head=none"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=none head=$sha"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=01 head=$sha"
expect_parse_fail "PM_DIRECTIVE: team=qa assignee=lead action=execute pr=1 head=ABCDEF"

# Explicit team leads are always separate from Claude.
expect_route product lead execute none lead owner:codex area:app
expect_route ux lead execute none lead owner:codex area:app
expect_route engineering lead execute none lead owner:codex area:app
expect_route data lead execute none lead owner:codex area:data
expect_route qa lead execute none lead owner:codex area:qa
expect_route release lead execute none lead owner:codex area:infra

# Explicit Claude delegation.
expect_route product claude execute none claude owner:claude area:app
expect_route data claude execute none claude owner:claude area:data
expect_route release claude execute none claude owner:claude area:infra

# Auto execution defaults to the departmental team lead.
expect_route engineering auto execute none lead owner:codex area:app
expect_route qa auto execute none lead owner:codex area:qa

# Auto review chooses the opposite executor.
expect_route engineering auto review owner:codex claude owner:claude area:app
expect_route data auto review owner:claude lead owner:codex area:data
expect_route qa auto review none claude owner:claude area:qa

echo "pm assignment dispatcher contract checks passed: $checks"
