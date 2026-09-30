#!/usr/bin/env bash
# Offline regression tests for .github/workflows/ai-pm-review-queue.yml.
#
# Extracts the enqueue/drain `run:` scripts from the workflow and runs them against a
# mock `gh` backed by a JSON state file (issues, comments, labels, PRs, runs, reviews),
# with fault injection for failed API writes. No network, no GitHub token.
#
# Usage: bash .github/scripts/test-pm-review-queue.sh
# Requires: bash, jq, python3 with PyYAML.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ai-pm-review-queue.yml"
REVIEW_WORKFLOW="$ROOT/.github/workflows/ai-handoff-review-events.yml"
CI_GATE_WORKFLOW="$ROOT/.github/workflows/ai-handoff-ci-gate.yml"
CLAUDE_WORKFLOW="$ROOT/.github/workflows/ai-handoff-claude.yml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

REPO="onepick/repo"
OWNER="owner"
BOT="handoff[bot]"
H1="1111111111111111111111111111111111111111"
H2="2222222222222222222222222222222222222222"
H3="3333333333333333333333333333333333333333"

# --- extract workflow pieces -------------------------------------------------------
python3 - "$WORKFLOW" "$REVIEW_WORKFLOW" "$CI_GATE_WORKFLOW" "$WORK" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
review_wf = yaml.safe_load(open(sys.argv[2]))
ci_wf = yaml.safe_load(open(sys.argv[3]))
out = sys.argv[4]
jobs = wf["jobs"]
open(f"{out}/enqueue.sh", "w").write(jobs["enqueue"]["steps"][1]["run"])
open(f"{out}/drain.sh", "w").write(jobs["drain"]["steps"][1]["run"])
open(f"{out}/enqueue_if.txt", "w").write(jobs["enqueue"]["if"])
open(f"{out}/review_enqueue_if.txt", "w").write(review_wf["jobs"]["enqueue"]["if"])
open(f"{out}/review_drain.sh", "w").write(review_wf["jobs"]["drain"]["steps"][1]["run"])
open(f"{out}/ci_gate_if.txt", "w").write(ci_wf["jobs"]["gate"]["if"])
open(f"{out}/drain_if.txt", "w").write(jobs["drain"]["if"])
c = jobs["drain"].get("concurrency") or {}
open(f"{out}/drain_concurrency.txt", "w").write(f'{c.get("group","")}|{c.get("cancel-in-progress")}')
open(f"{out}/enqueue_concurrency.txt", "w").write(str(jobs["enqueue"].get("concurrency", "")))
open(f"{out}/top_concurrency.txt", "w").write(str(wf.get("concurrency", "")))
PY

# --- mock gh -----------------------------------------------------------------------
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gh" <<'PY'
#!/usr/bin/env python3
import json, os, subprocess, sys

STATE = os.environ["MOCK_STATE"]
st = json.load(open(STATE))

def save():
    json.dump(st, open(STATE, "w"))

def fail_if(op, text=""):
    for f in st.get("fail", []):
        if f["op"] == op and f.get("match", "") in text and f["times"] != 0:
            if f["times"] > 0:
                f["times"] -= 1
            st["calls"].append({"op": op, "failed": True})
            save()
            sys.stderr.write(f"mock gh: injected failure for {op}\n")
            sys.exit(1)

def tick():
    st["clock"] += 1
    return "2026-09-29T00:%02d:%02dZ" % (st["clock"] // 60 % 60, st["clock"] % 60)

def issue_view(n):
    i = st["issues"][n]
    return {"number": int(n), "state": i["state"], "labels": [{"name": l} for l in i["labels"]],
            "comments": len(i["comments"])}

def out(obj, jq_expr=None):
    data = json.dumps(obj)
    if jq_expr is not None:
        r = subprocess.run(["jq", "-r", jq_expr], input=data, capture_output=True, text=True)
        if r.returncode != 0:
            sys.stderr.write(r.stderr); sys.exit(r.returncode)
        sys.stdout.write(r.stdout)
    else:
        sys.stdout.write(data + "\n")

args = sys.argv[1:]
st["calls"].append({"argv": args})

if args[:2] == ["issue", "comment"]:
    n = args[2]
    body = args[args.index("--body") + 1]
    fail_if("comment", body)
    if n not in st["issues"]:
        sys.exit(1)
    st["next_id"] += 1
    st["issues"][n]["comments"].append({"id": st["next_id"], "user": {"login": st["bot"]},
                                        "body": body, "created_at": tick()})
    save()
    sys.exit(0)

if args[0] != "api":
    sys.stderr.write(f"mock gh: unsupported {args}\n"); sys.exit(2)

method, path, jq_expr, fields, rest = "GET", None, None, [], args[1:]
i = 0
while i < len(rest):
    a = rest[i]
    if a in ("-X", "--method"): method = rest[i + 1]; i += 2
    elif a == "--jq": jq_expr = rest[i + 1]; i += 2
    elif a == "-f": fields.append(rest[i + 1]); i += 2
    elif a == "--paginate": i += 1
    elif a == "--input": i += 2
    elif path is None: path = a; i += 1
    else: sys.stderr.write(f"mock gh: unexpected arg {a}\n"); sys.exit(2)

p = path.split("?")[0].split("/")[3:]  # after repos/<o>/<r>
fail_if("api", f"{method} {'/'.join(p)}")

if p[0] == "issues" and len(p) == 1:
    out([issue_view(n) for n, v in st["issues"].items() if v["state"] == "open"], jq_expr)
elif p[0] == "issues" and len(p) == 2:
    if p[1] not in st["issues"]: sys.exit(1)
    out(issue_view(p[1]), jq_expr)
elif p[0] == "issues" and len(p) == 3 and p[2] == "timeline":
    out(st.get("timelines", {}).get(p[1], []), jq_expr)
elif p[0] == "issues" and p[2] == "comments":
    out(st["issues"][p[1]]["comments"], jq_expr)
elif p[0] == "issues" and p[2] == "labels" and method == "POST":
    fail_if("labels")
    add = [f.split("=", 1)[1] for f in fields if f.startswith("labels[]=")]
    labels = st["issues"][p[1]]["labels"]
    for l in add:
        if l not in labels: labels.append(l)
    st["label_posts"] += 1
    save()
    out([{"name": l} for l in labels], jq_expr)
elif p[0] == "issues" and len(p) == 2 and method == "PATCH":
    st["label_patches"] += 1; save(); out({}, jq_expr)
elif p[0] == "pulls" and len(p) == 2:
    if p[1] not in st["pulls"]: sys.exit(1)
    out(st["pulls"][p[1]], jq_expr)
elif p[0] == "pulls" and p[2] == "reviews":
    out(st["reviews"].get(p[1], []), jq_expr)
elif p[0] == "actions" and p[1] == "runs":
    f = dict(x.split("=", 1) for x in fields)
    out({"workflow_runs": [r for r in st["runs"] if r["head_sha"] == f.get("head_sha")]}, jq_expr)
else:
    sys.stderr.write(f"mock gh: unsupported path {path}\n"); sys.exit(2)
save()
PY
chmod +x "$WORK/bin/gh"

export MOCK_STATE="$WORK/state.json"

# --- helpers -----------------------------------------------------------------------
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok - $*"; }
ng() { fail=$((fail + 1)); echo "  FAIL - $*"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else ng "$desc"; fi; }
q() { jq -r "$@" "$MOCK_STATE"; }

reset_state() {
  jq -n --arg bot "$BOT" --arg h1 "$H1" --arg h2 "$H2" --arg repo "$REPO" '
    def pr($n; $h; $issue): {number: $n, state: "open", merged: false, draft: false,
      body: "Refs #\($issue)", base: {ref: "main"}, head: {sha: $h, repo: {full_name: $repo}}};
    def ok_runs($h): [ "Mobile CI", "Database Tests", "Web build" ]
      | map({name: ., head_sha: $h, status: "completed", conclusion: "success", created_at: "2026-09-29T00:00:00Z"});
    {
      bot: $bot, next_id: 1000, clock: 0, calls: [], fail: [], label_posts: 0, label_patches: 0,
      issues: {
        "10": {state: "open", labels: ["owner:claude"], comments: []},
        "11": {state: "open", labels: ["owner:codex"], comments: []},
        "12": {state: "open", labels: [], comments: []},
        "13": {state: "open", labels: ["owner:claude"], comments: []}
      },
      pulls: {"20": pr(20; $h1; 10), "21": pr(21; $h1; 11), "22": pr(22; $h1; 12), "23": pr(23; $h1; 13)},
      reviews: {"20": [{commit_id: $h1, state: "COMMENTED"}]},
      runs: (ok_runs($h1) + ok_runs($h2))
    }' >"$MOCK_STATE"
}

mutate() { local t; t="$(mktemp)"; jq "$@" "$MOCK_STATE" >"$t" && mv "$t" "$MOCK_STATE"; }

# Evaluates the enqueue job condition for a comment body (mirrors the `if:` expression,
# which test_if_expression pins to exactly these three startsWith prefixes).
would_trigger() {
  case "$1" in
    'PM_REVIEW_REQUIRED: '*|'PM_REVIEW_DONE: '*|'<!-- onepick-ci-handoff:done pr='*) return 0 ;;
    *) return 1 ;;
  esac
}

LAST_ID=""
# add_comment <issue> <author> <body>: a comment appears on the issue (no workflow run).
add_comment() {
  mutate --arg n "$1" --arg a "$2" --arg b "$3" '
    .next_id += 1 | .clock += 1
    | .issues[$n].comments += [{id: .next_id, user: {login: $a}, body: $b, created_at: "2026-09-29T00:00:00Z"}]'
  LAST_ID="$(q '.next_id')"
}

ENQUEUED=""
# run_enqueue <issue> <comment id>: the enqueue job for that comment's issue_comment event.
run_enqueue() {
  local issue="$1" id="$2" author body
  author="$(q --arg n "$issue" --argjson id "$id" '.issues[$n].comments[] | select(.id == $id) | .user.login')"
  body="$(q --arg n "$issue" --argjson id "$id" '.issues[$n].comments[] | select(.id == $id) | .body')"
  ENQUEUED=""
  if ! would_trigger "$body"; then return 0; fi
  : >"$WORK/out"
  PATH="$WORK/bin:$PATH" GH_TOKEN=x REPOSITORY="$REPO" REPOSITORY_OWNER="$OWNER" APP_SLUG=handoff \
    ISSUE_NUMBER="$issue" SOURCE_AUTHOR="$author" SOURCE_ID="$id" \
    SOURCE_URL="https://github.com/$REPO/issues/$issue#issuecomment-$id" SOURCE_BODY="$body" \
    GITHUB_OUTPUT="$WORK/out" bash "$WORK/enqueue.sh" >>"$WORK/log" 2>&1
  ENQUEUED="$(sed -n 's/^enqueued=//p' "$WORK/out" | tail -n 1)"
}

DRAIN_RC=0
run_drain() {
  set +e
  PATH="$WORK/bin:$PATH" GH_TOKEN=x REPOSITORY="$REPO" REPOSITORY_OWNER="$OWNER" APP_SLUG=handoff EVENT_ISSUE="$1" MAX_ATTEMPTS=3 \
    REQUIRED_WORKFLOWS='["Mobile CI","Database Tests","Web build"]' bash "$WORK/drain.sh" >>"$WORK/log" 2>&1
  DRAIN_RC=$?
  set -e
}

REVIEW_DRAIN_RC=0
run_review_drain() {
  set +e
  PATH="$WORK/bin:$PATH" GH_TOKEN=x REPOSITORY="$REPO" REPOSITORY_OWNER="$OWNER" APP_SLUG=handoff \
    EVENT_QUEUE_ISSUE="$1" REQUIRED_WORKFLOWS='["Mobile CI","Database Tests","Web build"]' \
    CI_GATE_ENABLED="${2:-}" bash "$WORK/review_drain.sh" >>"$WORK/log" 2>&1
  REVIEW_DRAIN_RC=$?
  set -e
}

# comment <issue> <author> <body> [drain|nodrain]: full event (comment + workflow run).
comment() {
  add_comment "$1" "$2" "$3"
  local id="$LAST_ID"
  run_enqueue "$1" "$id"
  if [ "${4:-drain}" = "drain" ] && [ "$ENQUEUED" = "true" ]; then run_drain "$1"; fi
  LAST_ID="$id"
}

count_bot() { q --arg n "$1" --arg m "$2" --arg bot "$BOT" '[.issues[$n].comments[] | select(.user.login == $bot and (.body | contains($m)))] | length'; }
has_label() { q --arg n "$1" --arg l "$2" '.issues[$n].labels | index($l) != null' | grep -qx true; }
eq() { [ "$1" = "$2" ] || { echo "    expected '$2', got '$1'" >&2; return 1; }; }

gate_body() { printf '<!-- onepick-ci-handoff:done pr=%s -->\n## 필수 CI 통과\nPR: #%s (head `%s`)\n\n후속: 사용자 병합 판단 대기' "$1" "$1" "${2:0:7}"; }

# --- tests -------------------------------------------------------------------------
echo "# workflow shape"
check "routing queues: independent from AI model runner switch" \
  bash -c "! grep -q 'ONEPICK_AI_HANDOFF_ENABLED' '$WORK/enqueue_if.txt' &&
           ! grep -q 'ONEPICK_AI_HANDOFF_ENABLED' '$WORK/review_enqueue_if.txt' &&
           ! grep -q 'ONEPICK_AI_HANDOFF_ENABLED' '$WORK/ci_gate_if.txt'"
check "routing queues: shared opt-out kill switch is present" \
  bash -c "grep -q \"ONEPICK_PM_ROUTING_ENABLED != 'false'\" '$WORK/enqueue_if.txt' &&
           grep -q \"ONEPICK_PM_ROUTING_ENABLED != 'false'\" '$WORK/review_enqueue_if.txt' &&
           grep -q \"ONEPICK_PM_ROUTING_ENABLED != 'false'\" '$WORK/ci_gate_if.txt'"
check "CI handoff gate is explicit opt-in" \
  bash -c "grep -q \"ONEPICK_CI_HANDOFF_GATE_ENABLED == 'true'\" '$WORK/ci_gate_if.txt' &&
           ! grep -q 'ONEPICK_CI_HANDOFF_GATE_ENABLED' '$WORK/enqueue_if.txt' &&
           ! grep -q 'ONEPICK_CI_HANDOFF_GATE_ENABLED' '$WORK/review_enqueue_if.txt'"
check "review drain receives the CI gate state" \
  grep -q 'CI_GATE_ENABLED' "$WORK/review_drain.sh"
check "Claude model Action remains explicit opt-in" \
  bash -c "grep -q \"ONEPICK_AI_HANDOFF_ENABLED == 'true'\" '$CLAUDE_WORKFLOW' &&
           grep -q \"ONEPICK_CLAUDE_ACTION_ENABLED == 'true'\" '$CLAUDE_WORKFLOW' &&
           grep -q \"ONEPICK_CLAUDE_GITHUB_ACTION_ENABLED == 'true'\" '$CLAUDE_WORKFLOW'"
check "enqueue if: first-line startsWith only (no contains)" \
  bash -c "grep -q \"startsWith(github.event.comment.body, 'PM_REVIEW_REQUIRED: ')\" '$WORK/enqueue_if.txt' &&
           grep -q \"startsWith(github.event.comment.body, 'PM_REVIEW_DONE: ')\" '$WORK/enqueue_if.txt' &&
           grep -q \"startsWith(github.event.comment.body, '<!-- onepick-ci-handoff:done pr=')\" '$WORK/enqueue_if.txt' &&
           ! grep -q 'contains(' '$WORK/enqueue_if.txt'"
check "drain runs only when enqueue reported enqueued=true" grep -q "needs.enqueue.outputs.enqueued == 'true'" "$WORK/drain_if.txt"
check "drain is serialized repository-wide without cancel-in-progress" \
  eq "$(cat "$WORK/drain_concurrency.txt")" 'ai-pm-review-queue-drain-${{ github.repository }}|False'
check "enqueue and workflow level have no concurrency" \
  bash -c "[ -z \"\$(cat '$WORK/enqueue_concurrency.txt')\" ] && [ -z \"\$(cat '$WORK/top_concurrency.txt')\" ]"

echo "# three events in a row, only the last drain runs (pending replacement)"
reset_state
add_comment 11 "$BOT" "<!-- onepick-pm-review:required issue=11 pr=21 head=$H1 -->"$'\n'"## PM 검토 대기"
add_comment 13 "$BOT" "<!-- onepick-ci-handoff:pending pr=23 next=user -->"
comment 11 "$OWNER" "PM_REVIEW_DONE: decision=continue pr=21 head=$H1" nodrain; e1="$ENQUEUED"
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none" nodrain; e2="$ENQUEUED"
comment 13 "$BOT" "$(gate_body 23 "$H1")" nodrain; e3="$ENQUEUED"
check "all three events were enqueued" eq "$e1$e2$e3" "truetruetrue"
run_drain 13
check "drain succeeded" eq "$DRAIN_RC" 0
check "DONE on #11 recorded" eq "$(count_bot 11 "<!-- onepick-pm-review:done issue=11 pr=21 head=$H1 decision=continue -->")" 1
check "REQUIRED on #12 created" eq "$(count_bot 12 '<!-- onepick-pm-review:required issue=12 pr=none head=none -->')" 1
check "gate next=user on #13 created merge-ready queue" eq "$(count_bot 13 "<!-- onepick-pm-review:required issue=13 pr=23 head=$H1 -->")" 1
check "every item has one processed marker" \
  eq "$(( $(count_bot 11 'onepick-pm-queue:processed') + $(count_bot 12 'onepick-pm-queue:processed') + $(count_bot 13 'onepick-pm-queue:processed') ))" 3

echo "# cancelled drain and failed drain are recovered by the next drain"
reset_state
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=review-complete pr=22 head=$H1" nodrain   # drain cancelled
check "no request before any drain" eq "$(count_bot 12 'onepick-pm-review:required')" 0
mutate '.fail = [{op: "api", match: "GET issues", times: -1}]'
run_drain 12
check "drain during API outage exits non-zero" bash -c "[ $DRAIN_RC -ne 0 ]"
mutate '.fail = []'
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none"
check "unrelated issue's drain collected #12" eq "$(count_bot 12 "<!-- onepick-pm-review:required issue=12 pr=22 head=$H1 -->")" 1
check "#10 processed too" eq "$(count_bot 10 '<!-- onepick-pm-review:required issue=10 pr=none head=none -->')" 1

echo "# same SOURCE_ID is queued and processed once"
reset_state
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=22 head=$H1"
src="$LAST_ID"
run_enqueue 12 "$src"   # workflow re-run
check "re-run still reports enqueued (drain collects)" eq "$ENQUEUED" true
run_drain 12; run_drain 12
check "one pending marker per SOURCE_ID" eq "$(count_bot 12 "onepick-pm-queue:pending source=comment-$src ")" 1
check "one processed marker per SOURCE_ID" eq "$(count_bot 12 "onepick-pm-queue:processed source=comment-$src ")" 1
check "one PM review request" eq "$(count_bot 12 'onepick-pm-review:required')" 1
add_comment 12 "$BOT" "<!-- onepick-pm-queue:pending source=comment-$src kind=required arg=stage-complete pr=22 head=$H1 -->"
run_drain 12
check "duplicate pending marker is not reprocessed" eq "$(count_bot 12 "onepick-pm-queue:processed source=comment-$src ")" 1

echo "# bot comments never start the workflow"
reset_state
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=22 head=$H1"
comment 12 "$OWNER" "PM_REVIEW_DONE: decision=revise pr=22 head=$H1"
comment 12 "$OWNER" "PM_REVIEW_DONE: decision=revise pr=22 head=$H1"   # duplicate decision -> skip note
bot_triggers="$(q --arg bot "$BOT" '.issues["12"].comments[] | select(.user.login == $bot) | .body | @base64' |
  while read -r b; do if would_trigger "$(printf '%s' "$b" | base64 -d)"; then echo x; fi; done | wc -l)"
check "no bot-authored comment matches the job condition" eq "$bot_triggers" 0
check "the PM 검토 대기 summary quotes PM_REVIEW_DONE (still no trigger)" \
  bash -c "[ $(count_bot 12 'PM_REVIEW_DONE: decision=') -ge 1 ]"
add_comment 12 "$OWNER" "완료 리포트"$'\n'"PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none"
id="$LAST_ID"; run_enqueue 12 "$id"
check "command on a later line does not start a run" eq "$ENQUEUED" ""

echo "# drain follows source comment order, not enqueue order"
reset_state
add_comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=22 head=$H1"; first="$LAST_ID"
add_comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=merge-ready pr=22 head=$H1"; second="$LAST_ID"
run_enqueue 12 "$second"; run_enqueue 12 "$first"   # the later comment's enqueue finished first
run_drain 12
check "earlier request wins the (issue, pr, head) key" eq "$(count_bot 12 '부서/단계 작업 완료')" 1
check "later request for the same key skipped" eq "$(count_bot 12 "processed source=comment-$second ")$(count_bot 12 '이미 대기 중')" "11"

echo "# CRLF and very long bodies"
reset_state
long="$(head -c 100000 /dev/zero | tr '\0' 'a')"
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none"$'\r\n'"$long"
check "CRLF first line with a >64KB body is enqueued" eq "$ENQUEUED" true
check "and processed" eq "$(count_bot 12 '<!-- onepick-pm-review:required issue=12 pr=none head=none -->')" 1

echo "# review-events with CI gate disabled"
reset_state
mutate --arg owner "$OWNER" '
  .pulls["22"].draft = true
  | .pulls["22"].user = {login: $owner}
  | .issues["12"].labels = ["owner:codex"]
  | .issues["12"].comments += [
      {id: 1900, user: {login: .bot}, created_at: "2026-09-29T00:00:01Z",
       body: "<!-- onepick-review-handoff:done key=22-1111111111111111111111111111111111111111-CHANGES_REQUESTED to=codex -->"},
      {id: 1901, user: {login: .bot}, created_at: "2026-09-29T00:00:02Z",
       body: "<!-- onepick-review-queue:pending source=comment-1800 pr=22 head=1111111111111111111111111111111111111111 result=READY_FOR_REVIEW to=claude by=owner -->"}
    ]'
run_review_drain 12 false
check "review drain succeeds with CI gate disabled" eq "$REVIEW_DRAIN_RC" 0
check "gate-off draft result is processed" eq "$(count_bot 12 'onepick-review-queue:processed source=comment-1800')" 1
check "gate-off draft result leaves no done marker" eq "$(count_bot 12 'onepick-review-handoff:done key=22-1111111111111111111111111111111111111111-READY_FOR_REVIEW')" 0
check "gate-off draft result leaves no CI pending marker" eq "$(count_bot 12 'onepick-ci-handoff:pending pr=22')" 0
check "gate-off draft result asks for a later repost" eq "$(count_bot 12 'CI gate가 비활성 상태입니다')" 1

echo "# review-events with CI running and CI gate disabled"
reset_state
mutate --arg owner "$OWNER" '
  .pulls["22"].user = {login: $owner}
  | .issues["12"].labels = ["owner:codex"]
  | .timelines = {"22": [{event: "ready_for_review", created_at: "2026-09-28T00:00:00Z"}]}
  | (.runs[] | select(.head_sha == "1111111111111111111111111111111111111111" and .name == "Web build")
       | .status = "in_progress" | .conclusion = "")
  | .issues["12"].comments += [
      {id: 1910, user: {login: .bot}, created_at: "2026-09-29T00:00:01Z",
       body: "<!-- onepick-review-handoff:done key=22-1111111111111111111111111111111111111111-CHANGES_REQUESTED to=codex -->"},
      {id: 1911, user: {login: .bot}, created_at: "2026-09-29T00:00:02Z",
       body: "<!-- onepick-review-queue:pending source=comment-1810 pr=22 head=1111111111111111111111111111111111111111 result=READY_FOR_REVIEW to=claude by=owner -->"}
    ]'
run_review_drain 12 false
check "review drain succeeds while CI is running and gate is disabled" eq "$REVIEW_DRAIN_RC" 0
check "gate-off running result is processed" eq "$(count_bot 12 'onepick-review-queue:processed source=comment-1810')" 1
check "gate-off running result leaves no done marker" eq "$(count_bot 12 'onepick-review-handoff:done key=22-1111111111111111111111111111111111111111-READY_FOR_REVIEW')" 0
check "gate-off running result leaves no CI pending marker" eq "$(count_bot 12 'onepick-ci-handoff:pending pr=22')" 0
check "gate-off running result asks for a later repost" eq "$(count_bot 12 '필수 CI 진행 중, CI gate 비활성')" 1

echo "# CI gate routing"
reset_state
add_comment 10 "$BOT" "<!-- onepick-ci-handoff:pending pr=20 next=claude -->"
comment 10 "$BOT" "$(gate_body 20 "$H1")"
check "next=claude gate is not enqueued (no drain)" eq "$ENQUEUED" ""
check "next=claude gate creates no PM queue" eq "$(count_bot 10 'onepick-pm-review:required')" 0
add_comment 11 "$BOT" "<!-- onepick-ci-handoff:pending pr=21 next=codex -->"
comment 11 "$BOT" "$(gate_body 21 "$H1")"
check "next=codex gate creates no PM queue" eq "$(count_bot 11 'onepick-pm-queue:pending')$(count_bot 11 'onepick-pm-review:required')" "00"
add_comment 13 "$BOT" "<!-- onepick-ci-handoff:pending pr=23 next=user -->"
comment 13 "$BOT" "$(gate_body 23 "$H1")"
check "next=user gate creates merge-ready queue" eq "$(count_bot 13 "<!-- onepick-pm-review:required issue=13 pr=23 head=$H1 -->")" 1
check "summary shows required CI" bash -c "[ $(count_bot 13 'Mobile CI success / Database Tests success / Web build success') -eq 1 ]"
comment 13 "$OWNER" "PM_REVIEW_REQUIRED: reason=merge-ready pr=23 head=$H1"
check "explicit merge-ready for same key does not duplicate" eq "$(count_bot 13 'onepick-pm-review:required')" 1
comment 13 "$OWNER" "$(gate_body 23 "$H1")"
check "gate comment forged by owner is not enqueued" eq "$ENQUEUED" ""

echo "# stale / blocked / closed / handoff / forged / untrusted"
reset_state
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=20 head=$H2"
check "stale head: no request" eq "$(count_bot 10 'onepick-pm-review:required')" 0
check "stale head: processed with reason" bash -c "[ $(count_bot 10 'stale head') -eq 1 ]"
add_comment 13 "$BOT" "<!-- onepick-ci-handoff:pending pr=23 next=user -->"
gid=""; add_comment 13 "$BOT" "$(gate_body 23 "$H1")"; gid="$LAST_ID"
mutate --arg h "$H2" '.pulls["23"].head.sha = $h'       # PR moved before the drain ran
run_enqueue 13 "$gid"; run_drain 13
check "gate result for a previous head: no request" eq "$(count_bot 13 'onepick-pm-review:required')" 0
mutate '.issues["11"].labels += ["state:blocked"]'
comment 11 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=21 head=$H1"
check "blocked: no request" eq "$(count_bot 11 'onepick-pm-review:required')" 0
mutate '.issues["12"].labels += ["handoff:codex"]'
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=22 head=$H1"
check "handoff queued: no request" eq "$(count_bot 12 'onepick-pm-review:required')" 0
mutate '.issues["12"].labels -= ["handoff:codex"] | .pulls["22"].body = "no ref"'
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=review-complete pr=22 head=$H1"
check "PR not referencing the issue: no request" eq "$(count_bot 12 'onepick-pm-review:required')" 0
comment 10 "mallory" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none"
check "untrusted author is not enqueued" eq "$ENQUEUED" ""
add_comment 10 "$OWNER" "<!-- onepick-pm-review:required issue=10 pr=20 head=$H1 -->"
comment 10 "$OWNER" "PM_REVIEW_DONE: decision=continue pr=20 head=$H1"
check "forged required marker (non-bot) cannot record a decision" eq "$(count_bot 10 'onepick-pm-review:done')" 0
add_comment 10 "$OWNER" "<!-- onepick-pm-queue:pending source=comment-1 kind=required arg=stage-complete pr=none head=none -->"
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=release-approval pr=20 head=$H1"
check "forged pending marker (non-bot) is ignored" eq "$(count_bot 10 'source=comment-1 ')" 0
check "valid request after forgeries is created once" eq "$(count_bot 10 'onepick-pm-review:required')" 1
mutate '.issues["12"].state = "closed"'
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none"
check "closed issue is not enqueued" eq "$ENQUEUED" ""

echo "# stale PM decisions"
reset_state
add_comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=20 head=$H1"; r="$LAST_ID"
add_comment 10 "$OWNER" "PM_REVIEW_DONE: decision=continue pr=20 head=$H1"; d="$LAST_ID"
run_enqueue 10 "$r"; run_enqueue 10 "$d"; run_drain 10
check "request created" eq "$(count_bot 10 'onepick-pm-review:required')" 1
check "decision written before the request summary is not recorded" eq "$(count_bot 10 'onepick-pm-review:done')" 0
check "premature decision reported as stale" bash -c "[ $(count_bot 10 '오래된 판정') -eq 1 ]"
mutate --arg h "$H2" '.pulls["20"].head.sha = $h'
comment 10 "$OWNER" "PM_REVIEW_DONE: decision=continue pr=20 head=$H1"
check "decision for a replaced head is not recorded" eq "$(count_bot 10 'onepick-pm-review:done')" 0
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=20 head=$H2"
comment 10 "$OWNER" "PM_REVIEW_DONE: decision=user-approval pr=20 head=$H2"
check "decision for current head after its request is recorded" \
  eq "$(count_bot 10 "<!-- onepick-pm-review:done issue=10 pr=20 head=$H2 decision=user-approval -->")" 1
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=20 head=$H2"
check "no re-request after a decision" eq "$(count_bot 10 "onepick-pm-review:required issue=10 pr=20 head=$H2 ")" 1

echo "# PM decisions: owner account only, never the shared handoff App bot"
reset_state
comment 12 "$BOT" "PM_REVIEW_REQUIRED: reason=review-complete pr=22 head=$H1"
check "bot may still request a PM review" eq "$(count_bot 12 "<!-- onepick-pm-review:required issue=12 pr=22 head=$H1 -->")" 1
comment 12 "$BOT" "PM_REVIEW_DONE: decision=continue pr=22 head=$H1"; botdone="$LAST_ID"
check "bot PM_REVIEW_DONE is not enqueued" eq "$ENQUEUED" ""
check "bot PM_REVIEW_DONE leaves no pending marker" eq "$(count_bot 12 "source=comment-$botdone ")" 0
comment 12 "$BOT" "PM_REVIEW_DONE: decision=block pr=22 head=$H1"
check "bot decision=block adds no label" bash -c "! jq -e '.issues[\"12\"].labels | index(\"state:blocked\")' '$MOCK_STATE' >/dev/null"
# Shared App identity forges a pending marker for its own DONE comment.
add_comment 12 "$BOT" "<!-- onepick-pm-queue:pending source=comment-$botdone kind=done arg=continue pr=22 head=$H1 -->"
run_drain 12
check "forged bot pending for a bot DONE is not recorded" eq "$(count_bot 12 'onepick-pm-review:done')" 0
check "forged bot pending closed with reason" bash -c "[ $(count_bot 12 'handoff App 판정은 인정하지 않음') -eq 1 ]"
comment 12 "$OWNER" "PM_REVIEW_DONE: decision=continue pr=22 head=$H1"; ownerdone="$LAST_ID"
check "owner PM_REVIEW_DONE is recorded" eq "$(count_bot 12 "<!-- onepick-pm-review:done issue=12 pr=22 head=$H1 decision=continue -->")" 1
check "owner decision recorded once" eq "$(count_bot 12 'onepick-pm-review:done')" 1

reset_state
comment 13 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=23 head=$H1"
add_comment 13 "$OWNER" "PM_REVIEW_DONE: decision=continue pr=23 head=$H1"; od="$LAST_ID"
add_comment 13 "$BOT" "<!-- onepick-pm-queue:pending source=comment-$od kind=done arg=block pr=23 head=$H1 -->"
run_drain 13
check "forged pending that alters an owner decision is not recorded" eq "$(count_bot 13 'onepick-pm-review:done')" 0
check "altered decision applies no label" eq "$(q '.label_posts')" 0

echo "# decision=block and record-failure recovery"
reset_state
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=release-approval pr=22 head=$H1"
mutate '.fail = [{op: "comment", match: "onepick-pm-review:done", times: 1}]'
comment 12 "$OWNER" "PM_REVIEW_DONE: decision=block pr=22 head=$H1"; blk="$LAST_ID"
check "record failure makes the drain fail" bash -c "[ $DRAIN_RC -ne 0 ]"
check "label applied before the failed record" has_label 12 "state:blocked"
check "item left pending with one failure marker" \
  eq "$(count_bot 12 "onepick-pm-queue:processed source=comment-$blk ")$(count_bot 12 "onepick-pm-queue:failed source=comment-$blk ")" "01"
run_drain 12
check "recovery drain succeeds" eq "$DRAIN_RC" 0
check "decision recorded once" eq "$(count_bot 12 "decision=block -->")" 1
check "recovery notes the label was already applied" bash -c "[ $(count_bot 12 '이미 적용됨') -eq 1 ]"
check "state:blocked added exactly once (additive call)" eq "$(q '.label_posts')" 1
check "no full label rewrite (PATCH) used" eq "$(q '.label_patches')" 0
run_drain 12
comment 12 "$OWNER" "PM_REVIEW_DONE: decision=block pr=22 head=$H1"
check "no second label call or record" eq "$(q '.label_posts')$(count_bot 12 'decision=block -->')" "11"
comment 12 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none"
check "blocked issue: later requests skipped" eq "$(count_bot 12 'onepick-pm-review:required issue=12 pr=none')" 0

echo "# retry cap and ordering"
reset_state
mutate '.fail = [{op: "api", match: "GET pulls/20", times: -1}]'
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=20 head=$H1" nodrain; a="$LAST_ID"
comment 10 "$OWNER" "PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none" nodrain; b="$LAST_ID"
run_drain 10
check "failed item blocks later items of the same issue" eq "$(count_bot 10 "processed source=comment-$b ")" 0
check "attempt 1 recorded" eq "$(count_bot 10 "failed source=comment-$a attempt=1 ")" 1
run_drain 10; run_drain 10
check "attempt 3 gives up with a processed marker" eq "$(count_bot 10 "processed source=comment-$a ")" 1
check "give-up note asks for manual check" bash -c "[ $(count_bot 10 '재시도 상한 도달') -eq 1 ]"
check "next item processed after give-up" eq "$(count_bot 10 '<!-- onepick-pm-review:required issue=10 pr=none head=none -->')" 1
run_drain 10
check "no retry after the cap" eq "$(count_bot 10 "failed source=comment-$a ")" 3
check "last drain clean" eq "$DRAIN_RC" 0

echo
echo "passed: $pass, failed: $fail"
if [ "$fail" -ne 0 ]; then
  echo "--- log ---"; tail -n 80 "$WORK/log"
  exit 1
fi
