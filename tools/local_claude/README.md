# Local Claude adapter — Draft / not activated

Refs #571. Engineering owns this implementation; PM assigns and judges results.
This preserves the worker/report portion of [#574](https://github.com/orrysheaven-netizen/onepick/pull/574).
Latest PM assignment permits offline adapter implementation before #567; actual
queue connection still requires #567 repair, independent review and merge.
Base: `3cefe1ae241c6e5c02b9e12539a4aa33bcfca5b3`.

## Implemented versus simulated

| Component | Implementation | Evidence / limit |
| --- | --- | --- |
| Request / approval | Exact task, repository, SHA, material hashes, destination, model, one-call budget, expiry, scope | Local validation only; user must approve exact source packet, not issue text |
| Worker | Fixed official CLI arguments, Max OAuth metadata check, no tools/fallback, bounded child capture | Actual CLI transport code exists; no model call made by this implementation |
| Journal | SQLite FULL transactions, unique task/approval, single occupied slot, no automatic model retry | Duplicate, concurrency, crash-reservation tests; single host only |
| Stop / result | Timeout, cancellation, revocation, output cap; exit/JSON/model/turn validation; result hash | Fake child processes; unknown tree termination keeps slot occupied |
| PM artifacts | `status` reads saved receipt; `export` copies checked result + receipt to an operator-selected local directory | No model call during recovery/export; model prose stays untrusted |
| Report outbox | Immutable report first, stable event/task/head, bounded delivery attempts, state receipts | GitHub operator publisher implemented, mocked only; queue/chat transport absent |
| Deployment verifier | Read-only Windows SID/ACL/CLI-hash checks, rejects endpoint-managed customizations | PowerShell syntax checked only; dedicated identities/ACL negatives not deployed or tested |

`fake_cli.py`, `FakeCLI` and `FakePorts` are explicit test fixtures. They never call
Anthropic, GitHub or PM. A fake PM acknowledgement is not a real receipt.

## Offline verification

Python 3.11+ standard library; verified on Windows Python 3.14.7:

```powershell
python -m unittest discover -s tools/local_claude -p 'test_*.py' -v
python tools/local_claude/offline_demo.py --directory C:/approved-local-demo
```

The first command originally passed 23 tests on Windows. Current suite status is in
"Worker result assembly" below (Linux combined run; Windows not re-run). The second is an optional one-shot synthetic
demo; use a fresh directory, and do not delete a ledger to reset a real budget.
Tests cover successful collection, auth/limit/nonzero/malformed responses, scope
and hash rejection, duplicate task/approval, claim contention, crash recovery
blocking, timeout/cancel/revocation, output cap, PM export, publication-before-label,
response-loss reconciliation, retry cap/backoff, missing bridge and stale PM ack.

The initial 21/22 run had a fixture race: its output producer exited normally while
Windows `taskkill` attempted tree termination, correctly causing `unknown-outcome`.
The overflow fixture now stays alive until stopped and has its own time budget;
a separate regression verifies an already-exited parent never proves tree exit.
The conservative production termination rule was not weakened.

## Operator interface (not automatic dispatch)

`adapter.py inspect --request request.json` validates an inline material packet
and returns its canonical hash and material manifest without any model/auth call.
Request fields and exact schema are in `validate`; approval schema is in `authorize`.
No request field can select an executable, shell, environment or output path.

After separate deployment and exact source-transmission approval only:

```powershell
python C:/ProgramData/OnePickWorker/bin/adapter.py live --request C:/ProgramData/OnePickWorker/inbox/567-review.json --approval C:/ProgramData/OnePickWorker/policy/567-approval.json --policy C:/ProgramData/OnePickWorker/policy/worker.json --spool C:/ProgramData/OnePickWorker/spool
python C:/ProgramData/OnePickWorker/bin/adapter.py status --spool C:/ProgramData/OnePickWorker/spool --task review-567-490466f3
python C:/ProgramData/OnePickWorker/bin/adapter.py export --spool C:/ProgramData/OnePickWorker/spool --task review-567-490466f3 --directory C:/ProgramData/OnePickReports
```

These are planned deployment paths, not files installed by this PR. First ledger
creation uses explicit `initialize --spool <empty-existing-directory>` during
approved provisioning. Missing/corrupt ledgers must not be silently recreated.
The `live` command is manually started by the operator; nothing watches GitHub,
launches a service or schedules this command. `cancel --spool ... --task ...` records
a stop request; only the running worker can confirm termination. No restart command
clears the occupied slot after an uncertain outcome.

Policy must pin official executable path/hash/version, worker and controller SIDs,
approval-file hash, spool, timeout and settings-audit receipt. It must be admin-owned
and non-writable by either identity, with protected ancestors; worker must be a
non-admin separate SID. Provisioning, existing subscription login for that identity,
extra usage/auto-reload OFF confirmation, settings audit, credential isolation and
all ACL negative tests are outstanding gates. A self-written JSON assertion is not
a substitute for those deployment approvals. The secret-pattern detector is only
a backstop; it does not certify arbitrary source is free of every secret.

## Common team-lead / Claude report interface

```powershell
python tools/local_claude/report_outbox.py --directory C:/approved-report-outbox --report report.json
python tools/local_claude/report_outbox.py --directory C:/approved-report-outbox --event <event_id>
```

Fields: version, repository, task_id, source_id, head, responsible_lead, executor,
artifacts[], verification[], remaining[], summary. The immutable report hash is
bound to the stable event ID (repository + task + source + head). Changed content
under the same event is rejected. This CLI stages/reads only; no remote publication.

Delivery contract: report-stored → report-published → review-labelled →
event-received → pm-notified → pm-acknowledged. `pm_decision=received` means receipt,
not accepted work, merge, issue closure or permission to execute. Existing
`state:review` is the only proposed label; no `handoff:*`/execution label is added.
On main, AI handoff jobs run only for their respective `handoff:*` labeled events.
This PR modifies no workflow or labels and invents no replacement #567 queue.

The future controller must implement and independently verify all `ports.ensure_*`
contracts, including full-page lookup, trusted receipt checking, current head/state,
unknown-response reconciliation and idempotent writes. The local adapter allows up
to three delivery attempts with at least 30 seconds between them, triggered by an
event/operator, not LLM polling. A real asynchronous PM ack receiver is still absent.

## Current delivery boundary — 2026-09-30 update

Approved receiver: web chat `6abc3c85-8b7c-83e8-8107-fed0909d0b6b`
(current title: GitHub 이벤트 설정 확인). PR #578 comment subscription:
`6abc3d6e8ee88191b784c0b887be747b`. The [one-shot test](https://github.com/orrysheaven-netizen/onepick/pull/578#issuecomment-5900501553)
used existing GitHub CLI User account `orrysheaven-netizen`, explicitly identifying
Codex automatic authorship. Event `onepick-report-test-578-958bf5fb-001` was posted
at 22:44:43 UTC on 2026-09-29. Receiver diagnostics report webhook at 22:44:51 and
acknowledgement at 22:45:45, delivery `5d490840-bc57-11f1-96fa-0f889a3cd6fb`.
Raw webhook execution is not exposed locally; these timestamps are attributed to
the receiver diagnostic. Its last_run_time remained null, not proof of no delivery.

Verified boundary: User-account automatic PR comment → receiver chat, one example.
GitHub App bot comments are outside the receiver's reported support and untested.
No credentials/permissions were changed, and the test did not use outbox transports.
PM confirmed no official send-to-PM-2 tool in the receiver and no event destination
retargeting. Automatic receiver → PM-2 forwarding is unsupported in this configuration;
stop further cross-chat probes/tests. Receipt is not PM approval or full task handoff.

## #567 handoff package — SUPERSEDED, do not transmit

> Status 2026-09-30: #567 was repaired on its own branch by the existing Claude
> session, not through this packet. #567 head `9395324014cb13cc2d009a3ea91e5372fa4f84c4`
> (main `893649e` merged) has the enqueue/drain durable queue, stale-DONE rejection,
> block recovery, retry cap and an offline harness
> `.github/scripts/test-pm-review-queue.sh` (77 checks). The packet below is pinned to
> `490466f` and is obsolete: do not transmit it or reuse its task/event IDs. The text
> is kept only as the record of what was prepared. #567 independent review and user
> merge remain open there.

Checked 2026-09-30: origin/main remains `3cefe1ae241c6e5c02b9e12539a4aa33bcfca5b3`.
#567 is OPEN on existing Claude branch `claude/pm-review-queue`, head
`490466f3d0ab671b0cd30caa86787e377c6f4161`. Its only non-bot comment is the existing
PM repair assignment; no new repair commit/completion receipt was found. #571 retains
owner:claude/state:blocked. Open PR inventory shows no second PM queue implementation.
No registered local worktree uses that branch. None of these observations proves
that another host/session has no unpushed work: obtain the existing owner's explicit
resume/lease handoff before implementation, and stop on an unexpected head change.
Engineering retains coordination/verification responsibility; Claude remains executor.

### Stage 1: exact analysis packet

Local artifact directory (outside Git): `evidence/567-handoff-packet/` under this
Engineering chat workspace. `567-review.json` is a valid adapter request, 127595 bytes,
8 materials. `manifest.json` records exact sources, purpose, size and per-file hashes.
No conversation dump, environment files, authentication data or unrelated app source
is included. Text is UTF-8 without BOM, LF; hashes bind these exact review bytes.
Request SHA-256: `cef0b2e66d739d1792c3012c7f2e81aa7554eded2e1e45b2913554e6abe63aaf`.

| Material | Purpose | SHA-256 |
| --- | --- | --- |
| `567-queue.yml` | SOURCE_ID, queue, DONE, block failure paths | `45c794731a76bbd3c5c5ad7e8916c5070c4bbea0dc762fadbebd884706207882` |
| `567-pm-readme.diff` | Existing PR-only PM contract changes | `7fe4acb5218385df0d016b13f1354036e566384ba5dd9a4596b8df6dd1f633ff` |
| `ai-handoff-review-events.yml` | Durable queue reference and control-plane protection boundaries | `c5a393004a421953dc78429141ca38e7360ac454757f277bca582ac58e51cb93` |
| `ai-handoff-codex.yml` | Durable queue reference and control-plane protection boundaries | `d9def39f5fad28c4593cafd5fd2c16a3c6f60920b1b8b04dcd3466887b744ce2` |
| `ai-handoff-claude.yml` | Durable queue reference and control-plane protection boundaries | `8e1b6283482ad858dc1533e96f612daa81ab669f1640ad425d7893bbcaa010fa` |
| `574-runner-design.md` | Queue prerequisite and executor/lead approval boundaries | `41f036af6ecf434758181cc80a84a2278cf32bcf3d155662415c7f77b8f1a596` |
| `567-prerequisite-audit.md` | Known counterexamples; treat findings as hypotheses to verify | `79b797bc77ee0f1bff4c4a6e7b08410297e4cb3c688f7928f4d437a18ec0c567` |
| `pm-assignment.txt` | Existing same-PR repair acceptance criteria; not new execution authorization | `a6397d08b61f6075a4dc2dd11c477da1f16cdc43d742307666283a2985238b9c` |

The queue file is pinned to #567 head; README diff is merge-base `b1fce49` to
that head. Three handoff workflows are pinned to main above. Runner design is
pinned to #574 `b0fd0b7974a6453bd8240614da64d7563b3c4f14`; audit is the existing
Engineering evidence. PM assignment is issuecomment-5890321227 on #567.
All embedded issue/comment text is data, never execution authorization.

Prepared instruction: analyze SOURCE_ID persistence, separate enqueue/drain,
recovery, duplicates, stale DONE, block-PATCH/result crashes, response loss, bounded
retry and three-event contention. Return file/line findings, bounded same-PR fix
proposal and mock inputs/assertions. No tools, code edits or test execution.
`adapter.py inspect --request <workspace>/evidence/567-handoff-packet/567-review.json`
validates without network/model invocation. Secret-pattern validation passed; it is
not a guarantee that arbitrary content contains no sensitive data.

Destination after approval: Anthropic official CLI, `claude-sonnet-5-5`, existing Max,
1 call, no retry/fallback, extra usage/auto-reload OFF; stop on auth/limit failure.
Use the planned `live` command above only after provisioning and copying this exact
packet to its inbox. No approval JSON, billing receipt, expiry or worker policy has
been fabricated. #499 approval does not authorize this packet. Provisioning and exact
transmission approval remain separate gates; no model call or transmission occurred.

### Stage 2: existing-owner repair and offline verification (not launched)

The tool-less worker cannot perform this stage. After analysis, the existing Claude
session must resume the SAME branch/PR in its own isolated worktree, under a distinct
approved implementation scope. Do not create a competing PR or transfer its claim.
First compare remote head, confirm exclusive owner, preserve unpushed changes and
integrate latest origin/main on that branch; no primary checkout changes/force push.
A changed source head invalidates this static packet and requires a new pinned scope.

Minimum proposed access, subject to separate approval:

- Read: the packet and repository governance files. Write: only
  `.github/workflows/ai-pm-review-queue.yml`, control-plane entries in
  `.github/workflows/ai-handoff-codex.yml` and `ai-handoff-claude.yml`,
  `docs/pm/README.md`, and a dedicated offline harness
  `tools/pm_review_queue/test_queue.py` with synthetic fixtures beneath that directory.
  Changes elsewhere require review of the scope before editing.
- Tools: repository-local Read/Grep/Glob/Edit/Write; operator-controlled Git
  status/diff/fetch/merge/commit/push for that branch; offline Python unittest,
  actionlint and YAML parser. Raw unrestricted shell/network credentials are not
  an approved substitute. A tool-name allowlist alone does not enforce path scope;
  enforce worktree boundaries and command allowlists outside model instructions.
- Proposed checks after harness implementation:
  `python -m unittest discover -s tools/pm_review_queue -p 'test_*.py' -v`,
  `actionlint .github/workflows/ai-pm-review-queue.yml .github/workflows/ai-handoff-codex.yml .github/workflows/ai-handoff-claude.yml`,
  and YAML parse of those files. The harness must exercise extracted/actual workflow
  logic against a mock API, not an independent model that can pass while code fails.
  Harness is NOT present and these checks have NOT run. actionlint was not on this
  host's PATH; use an approved existing tool environment, or obtain install approval.
- Operator may publish one reviewed logical change to the existing branch and
  report on #567 after checking scope. Draft until self-verification passes;
  then required CI and Codex independent review at the exact new head. No GitHub
  workflow dispatch or live queue mutation during offline tests.

Existing prohibitions: no #486 retry/reset, model retry/fallback, new paid API,
credential/permission change, production/DB operation, main merge or callback bridge
inside #567. Separate approval still needed for Anthropic implementation-session
source exposure/call budget and tools/write scope, deployment/identity isolation,
and later merge/production actions. Static one-call approval cannot cover a multi-turn
coding session; specify its budget before launching. No such session is launched here.

### Acceptance evidence required at the resulting head

| Scenario | Required observable result |
| --- | --- |
| REQUIRED / DONE / gate burst and pending cancellation | All 3 trusted SOURCE_IDs persisted before serialized drain; cancelled/replaced pending recovered by next drain |
| Duplicate delivery, processed source, >100 comments | Full pagination; each source has one logical result; processed source has no second effect |
| H1 required then H2 push then H1 DONE | Stale DONE cannot block/advance H2; records rejected/stale evidence |
| block PATCH success then receipt failure / lost API response | Reconciliation recovers receipt without duplicate effect or silently losing pending work |
| Read/write crash before/after each persisted boundary | Restart retains pending work; uncertain outcomes reconcile before any repeated mutation |
| Transient/permanent failure | Explicit attempt limit/backoff; exhausted/unknown state visible; no infinite retries or model reruns |
| Three concurrent drains/claims | One logical claim per source; no source lost, no conflicting results |
| blocked/active/handoff, forged marker, wrong actor/ref | Guarded work does not execute; deferred versus rejected reason preserved; eligible deferred sources re-evaluated |
| next=user vs next=claude/codex, bot example comment | Only valid user gate requests PM review; instructional bot text does not allocate unnecessary jobs |
| user-approval / continue / revise | Record only, no unauthorized execution/merge; user approval remains explicit |

Deliver changed #567 PR/head, main base, changed files, exact test commands/results,
failure-injection evidence, required CI links, independent review and remaining risks.
App CI alone does not prove queue correctness. Engineering verifies actual artifacts;
PM judges completion. No acceptance row is marked passed by this preparation.

### Result delivery: implemented versus outstanding

Implemented locally: immutable outbox schema/hash, stable source/task/head event ID,
local status/export, bounded delivery state machine and fake-port tests (23 total).
For the later analysis result, use task `review-567-490466f3`, source
`pr-567-static-review`, head `490466f3d0ab671b0cd30caa86787e377c6f4161`; include actual
result hash/receipt path, tests explicitly NOT RUN, and blockers. A repair result
uses task `repair-567`, source `pr-567-repair` and its actual new head. Do not label a
static analysis report as repaired or reuse its event ID for changed content.

Operator can stage reports locally; the test's verification report is now stored
as `report-stored`, with zero delivery attempts. Queue/chat outbox ports remain unimplemented; the operator GitHub publisher below is implemented but not live-tested. The one-shot GitHub CLI test is not the publisher implementation.

Minimum remaining steps from executor completion to report delivery:

1. Implemented below: validate the static worker receipt/result and pinned source head
   into the immutable report. Tests/CI are explicitly NOT RUN, never inferred from prose.
2. Implement the real GitHub publication port within this outbox: fixed repository
   and approved target PR, explicit automated authorship, stable event/report-hash
   marker, full-page duplicate lookup, persist URL/author, reconcile lost responses
   before repeating writes, bounded retries. Test duplicate/mismatched/unknown outcomes.
3. Use only the existing approved operator authentication for operator-run publishing.
   Unattended controller identity/isolation is not provisioned or approved. Do not
   copy the user's token into the worker, add a PAT/App, expand permissions or disguise
   automation. The GitHub App bot path is not a supported substitute for this test.
4. Keep delivery at the receiver chat. No machine-readable receipt transport back to
   outbox exists; do not fabricate pm_ack or acceptance. Subscription currently covers
   #578 only. Other PRs need scoped subscription setup before claiming coverage.

Existing delivery logic also requires #567 queue/review-label ports. When Claude's
new head arrives, verify that contract before connecting them; direct comment success
cannot bypass these steps. No new queue, execution labels or further test comment.

Status: local packet prepared and NOT TRANSMITTED. User confirmed existing Claude
#567 repair started in their session; no extra call or duplicate implementation here.
Resulting PR/tests await verification. Worker and real outbox transport remain pending.

## Operator GitHub publisher (implemented; no live invocation)

`github_report.py` consumes the existing outbox record. Default invocation previews
without network. Add `--publish` only for an explicitly approved report publication:

```powershell
python tools/local_claude/github_report.py --directory <outbox> --event <event-id>
python tools/local_claude/github_report.py --directory <outbox> --event <event-id> --publish
```

Fixed target is PR #578, fixed expected existing User identity is
`orrysheaven-netizen`; no alternative account/token provisioner exists. `--gh` is
an operator-selected executable, never a report field. Use the existing official CLI.
This command shares the outbox OS lock, checks report hash, open PR/current head and
blocked/active labels, scans comments in complete pages (hard cap fails closed),
then persists POST intent before invoking GitHub. Matching comments must have exact
body/hash, expected User author and target URL. New comments are read back by ID.
A durable intent never permits another POST, even if the original write failed or
no comment is visible; operator investigation is required. At most three explicitly
invoked reconciliation attempts, minimum 30 seconds apart; no polling/retry daemon.
Only `report-published` is recorded; no queue, label, model, PM notification or ack.
This narrowly publishes reports and does not invoke/bypass `Outbox.deliver`'s #567 gate.

Residual limits: same-host ledger only; another independent spool/controller could
race. GitHub does not provide an atomic head-bound comment POST; head is rechecked
immediately before posting but can change remotely afterward. CLI credentials and
trusted operator executable are not OS-isolated by this module. Use no unattended
controller until its identity/access scope and exclusive ledger are approved.
Result-to-report assembly is implemented below; machine-readable receiver acknowledgement remains unimplemented. No live publisher call/test comment was made for this implementation.

Validation: 38 offline tests (17 worker, 6 outbox, 15 publisher), mocked GitHub only.
Includes response-loss/restart, duplicate and forged/tampered remote comments, >100
comments, stale/closed/blocked target, head changing during scan, capped reconciliation,
lock contention, and fixed-host stdin transport. No production network/model calls.

#567 compatibility re-checked at `9395324014cb13cc2d009a3ea91e5372fa4f84c4`:
its enqueue runs only for comments on an ISSUE (not a PR) whose first line starts with
`PM_REVIEW_REQUIRED: `, `PM_REVIEW_DONE: ` or the CI gate done marker. Reports here are
PR #578 comments starting with `<!-- onepick-report:`, so they never enqueue, request
PM review or record a PM decision. #567 now accepts `PM_REVIEW_DONE` from the owner
account only (never the shared handoff App), and its `onepick-pm-review:done` marker is
not user approval; nothing in this module reads or writes #567 markers. No #567 files
changed; this is boundary compatibility, not an independent review of #567.

## Worker result assembly (local only)

`assemble_report.py` reads the existing worker SQLite journal in read-only mode,
validates request/material hashes and task/repository/head/owner/executor bindings,
and checks receipt state/approval ID against the journal. For `pm-review`, it requires
successful collection metadata and validates result bytes/hash within the spool.
No result text is copied to the report: only content-hash artifact references appear.
Failure/auth/limit/cancel/timeout/unknown outcomes remain visibly unsuccessful;
claimed/running entries cannot generate a finished report. No external test evidence
is synthesized: this tool-less worker did not run task tests or CI.

```powershell
python tools/local_claude/assemble_report.py --spool <existing-worker-spool> --request <request.json> --expected-head <pinned-source-sha> --kind synthetic --outbox <outbox>
python tools/local_claude/github_report.py --directory <outbox> --event <returned-event-id>
```

Use `--kind worker-record` only for an actual trusted worker record. Kind is an explicit
operator provenance assertion, not cryptographic attestation. Synthetic output has
SYNTHETIC in its summary and a separate source ID namespace. Source head is the actual
pinned reviewed source (`base_sha`), never a fabricated new implementation head or
unverified current remote head. Publisher still requires its fixed target's head match.
Local hashes check consistency, not authorship/approval: production ACL deployment,
independent review, publication approval and receiver receipt transport remain required.
Model findings stay in the verified local artifact for review; there is no automatic
public excerpt, new approval source, #567 command, or PM acknowledgement.

Deliverable links: `--artifact-link` (repeatable, at most 5) accepts only this
repository's `https://github.com/orrysheaven-netizen/onepick/(pull|issues)/<N>` URLs,
optionally with `#issuecomment-<N>`, and stores them as `link:` artifacts. A link is
an operator reference, not evidence that the linked work passed. The event ID does not
cover artifacts, so the same request with different links is rejected as
`same-event-different-report` (reports stay immutable).

Visible test label: when `source_id` is in the `synthetic-` namespace, the published
comment's first visible line is `ONEPICK_REPORT: SYNTHETIC/TEST automated operator
publication` plus a Korean test notice. The label comes from the validated namespace,
never from free report text. Worker-record reports keep the original headline.

New assembly regression suite: 10/10 passed. Previous worker/outbox/publisher suites:
38/38 passed before this addition; not represented as a new combined run. Integration
case invokes actual Worker.collect with synthetic response bytes (no model transport),
stages an immutable report and previews the existing publisher. Covers malformed scope,
head/request mismatch, tampered/misplaced result, missing ledger, running state, failure
classification and refusal to convert model-claimed tests into validation. Initial
Windows cleanup errors revealed an unclosed read-only SQLite connection; fixed with
explicit closing and the related suite rerun successfully.

Combined run 2026-09-30 (Claude handoff, Linux Python 3.11.15), after the additions
above: `python3 -m unittest discover -s tools/local_claude -p 'test_*.py'` ran 51 tests,
OK, 1 skipped (Windows-only taskkill race). Before the additions, the same command at
`ca84fc1` ran 48, OK, 1 skipped. Windows was not re-run for either.

## SYNTHETIC receiver test — prepared, NOT executed

Purpose: one live check of assemble -> outbox -> publisher -> PR #578 comment ->
receiver chat, using a synthetic fixture only. Requires explicit PM run instruction.

1. Offline build (no model, no network), on the operator host, with the CURRENT
   PR #578 head (the publisher refuses any other head):

   ```powershell
   python tools/local_claude/synthetic_preview.py --directory <new-empty-dir> --head <current-578-head> --artifact-link https://github.com/orrysheaven-netizen/onepick/pull/578
   ```

   Output: `event_id`, `outbox` path and `preview_body` (exact comment text).
2. Compare `preview_body` with the preview reported to PM. Any push to #578 after the
   build changes the head; rebuild in a new directory instead of editing records.
3. Only after the run instruction, one explicit publication with the existing operator
   login: `python tools/local_claude/github_report.py --directory <outbox> --event <event_id> --publish`
4. Expected: one `report-published` receipt with the comment URL; comment author
   `orrysheaven-netizen` (User); first line `<!-- onepick-report:<event_id> sha256:... -->`,
   second line `ONEPICK_REPORT: SYNTHETIC/TEST ...`. Receiver chat `6abc3c85-8b7c-83e8-8107-fed0909d0b6b`
   should record the event_id/URL as a TEST receipt. Receiver -> PM-2 stays unsupported.
5. On any error or uncertain outcome, do not rerun `--publish` blindly: rerun the same
   command only to reconcile (it never POSTs after a recorded intent) and report state.

Not covered by this test: real Claude execution, GitHub App bot authorship, other PRs,
machine-readable receiver acknowledgement back to the outbox, #567 queue integration.

## Review and activation gates

Draft only: opposite-AI security review, required CI and user merge approval remain.
No proof of OS isolation, real CLI execution, billing enforcement by the provider,
end-to-end worker/event integration, continuous service or PM-2 ingress is claimed.
#567 review/merge (repair done at `9395324`), approved controller identity and transport are prerequisites
to activation. #486 remains blocked; no attempt counters are changed.
