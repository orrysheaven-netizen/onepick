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
| Report outbox | Immutable report first, stable event/task/head, bounded delivery attempts, state receipts | All remote ports are fake in tests; no real GitHub/queue/chat transport configured |
| Deployment verifier | Read-only Windows SID/ACL/CLI-hash checks, rejects endpoint-managed customizations | PowerShell syntax checked only; dedicated identities/ACL negatives not deployed or tested |

`fake_cli.py`, `FakeCLI` and `FakePorts` are explicit test fixtures. They never call
Anthropic, GitHub or PM. A fake PM acknowledgement is not a real receipt.

## Offline verification

Python 3.11+ standard library; verified on Windows Python 3.14.7:

```powershell
python -m unittest discover -s tools/local_claude -p 'test_*.py' -v
python tools/local_claude/offline_demo.py --directory C:/approved-local-demo
```

The first command passed 23 tests. The second is an optional one-shot synthetic
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

## Current PM ingress blocker

The in-agent `send_message_to_thread` tool is not an external-program API.
[Official event tasks](https://learn.chatgpt.com/docs/automations#trigger-tasks-from-app-events)
support eligible web/mobile chats, not desktop/CLI/IDE. [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
supports delivery to a subscribed chat via a ChatGPT-issued callback/signing secret;
no such subscription for desktop PM-2 has been obtained. [App Server](https://learn.chatgpt.com/docs/app-server)
documents client integration, but its experimental server/WebSocket is not supported
for production. The installed CLI's default `app-server proxy` read-only probe failed
before handshake with Windows socket error 10050. This is a current unavailable path,
not proof all future connections are impossible. No private endpoints/tokens/app DB
were used. Actual external→PM notification/acknowledgement remains unverified.

## Narrow #567 handoff preparation (not sent)

Existing owner: Claude, same PR/branch `claude/pm-review-queue`; head
`490466f3d0ab671b0cd30caa86787e377c6f4161`, still OPEN at last check.
No claim transfer or duplicate implementation is performed. Reconfirm the owner is
not actively editing before a new implementation session; an unchanged remote head
does not prove no local work exists.

Proposed first tool-less task: independently review SOURCE_ID persistence,
pending/drain separation, stale DONE rejection, block-PATCH/result-record crash
recovery, duplicate/retry bounds and three-event contention. Return findings plus
specific offline mock scenarios; do not execute code, edit files, merge or retry #486.

Exact proposed material allowlist, to assemble and hash BEFORE seeking transmission
approval (no full conversation, credentials or unrelated app sources):

- #567 head above: `.github/workflows/ai-pm-review-queue.yml`, `docs/pm/README.md` diff.
- main `3cefe1ae241c6e5c02b9e12539a4aa33bcfca5b3`: `.github/workflows/ai-handoff-review-events.yml`,
  `.github/workflows/ai-handoff-codex.yml`, `.github/workflows/ai-handoff-claude.yml`.
- #574 head `b0fd0b7974a6453bd8240614da64d7563b3c4f14`:
  `docs/pm/engineering-local-runner-design-2026-09-29.md`.
- The existing #567 prerequisite audit and PM assignment comment
  `https://github.com/orrysheaven-netizen/onepick/pull/567#issuecomment-5890321227`.

Destination: Anthropic through official CLI, model `claude-sonnet-5-5`, existing Max
subscription, one call, no retry/fallback, extra usage/auto-reload OFF, no tools.
The planned command is the `live` command above, after packet hash, expiry and user
receipt are pinned. #499 approval does not cover these materials. They have not been
sent. Actual #567 code implementation requires an explicit non-overlapping owner
handoff and separately approved tool/write scope; this static adapter cannot perform
that implementation. No runnable approved packet/worker deployment currently exists.

## Review and activation gates

Draft only: opposite-AI security review, required CI and user merge approval remain.
No proof of OS isolation, real CLI execution, billing enforcement by the provider,
GitHub event integration, continuous service or PM ingress is claimed. #567 repair
and review/merge, receiver-location decision and approved transport are prerequisites
to activation. #486 remains blocked; no attempt counters are changed.
