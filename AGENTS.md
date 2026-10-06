# Shared priority rules

Before any OnePick work, read `docs/shared-working-rules.md`, then `docs/pm/README.md`, then `docs/pm/current-priorities.md`. Next read the department document that matches the task. These are the shared user-approved rules and PM operating baseline for ChatGPT/Codex, Claude, QA, automation, and other OnePick work. The user's latest explicit instruction remains highest priority. Newer user-approved PM/shared rules supersede older repository instructions when they conflict.

# Agent rules for this repository

Read `CLAUDE.md` first. It holds the branching rule (`main` is the single trunk, PRs only, required CI checks) and the working-tree rule. Both apply to every agent, not only Claude.

## Pull requests and CI cost

Open PRs as draft, push once per logical unit of work, and run `gh pr ready <number>` only after implementation and self-verification (never for blocked work). Required CI runs on `ready_for_review`; draft pushes skip it. See "Pull requests and CI cost" in `CLAUDE.md`.

## Working tree

The primary checkout is shared by several concurrent agent sessions. Never checkout, switch, commit, reset or stash there. Create your own worktree from `origin/main`, work and push from it, open the PR with `--head <branch>`, and remove the worktree after the merge. Uncommitted changes you find in the primary checkout belong to another session; leave them out of your commits.

## Role division

ChatGPT is the **OnePick General PM**. Under PM governance, ChatGPT/Codex remains the default Product / Technical Owner and implementation coordinator. Claude Code is the lead for **QA / Reliability / Security** and independent review, and may implement work explicitly delegated by the user, PM, or handoff queue. Workload is tracked by `size:S/M/L` points with **55:45 Codex:Claude as a planning reference, not a quota**. PM may dynamically assign more S/M work to Claude when Claude has more available capacity, including general app/UI fixes, performance work, QA automation, and Release tooling. **Figma editing remains ChatGPT-owned by default; Claude reviews Figma for consistency, accessibility, Foundations compliance, and app parity unless the user explicitly delegates an exception.** This delegation does not change Product policy ownership, Data/DB default implementation ownership, or the default authority model. High-risk changes require cross-review and user approval gates regardless of who implements them. GitHub is the source of truth, and agents must not implement the same feature in parallel. See `docs/ai-role-division.md`.

At session start, after the PM preflight above, read #553 `[PM] OnePick 총괄 PM 운영·우선순위 대시보드`, then #296 `[AI Ops] OnePick 작업·인계 대시보드`, then your existing owner/handoff queue, then only the referenced task/PR. If another chat only says `#N 확인`, treat that as a pointer: read GitHub #N directly instead of asking for copied instructions or reports. PM docs/#553 decide what should be done first; #296 and owner/handoff labels show who executes it. Avoid broad repository rereads unless the task requires them.

Supabase migrations, RLS/GRANT/SECURITY DEFINER, Auth core, Storage policies, secret/permission handling, security-sensitive workflows, and destructive production data work are **high-risk areas, not permanent Claude-only areas**. Respect the current `owner:*`, `handoff:*`, and explicit user instruction. If Codex implements a high-risk change, Claude performs the narrow independent review; if Claude implements it, Codex performs the narrow independent review. Production apply, secret/permission changes, destructive data operations, and `main` merge remain user approval gates.

## Daily QA report (check at the start of every session)

Claude Code files a QA report every morning at 07:00 KST as a GitHub issue titled `[Daily QA] YYYY-MM-DD` with the label `qa-report`. It covers errors and slowness that real users hit on the tester site. Before starting other work:

1. Open the most recent **open** issue labeled `qa-report` in `orrysheaven-netizen/onepick`. If there is none, continue normally.
2. Route its "수정 요청" items by `docs/ai-role-division.md`. Codex remains the default coordinator and handles product/UI/general bugs. For high-risk items, follow the current `owner:*`, `handoff:*`, workload allocation, or explicit user delegation; do not infer permanent ownership from the subject area alone. Skip items marked `진행 중`; an open PR already covers them. Ask the user first only if an item conflicts with the task they gave you.
3. For Codex-owned items, open one PR against `main` per item. Include `Refs #<issue>` and the item title in the PR body, and meet the item's "완료 기준". For Claude-delegated items, record the handoff and do not duplicate implementation. Any high-risk PR must receive narrow review from the opposite AI before user merge.
4. If an item is a false positive or can't be fixed, comment on the issue with the reason. Don't silently skip it.
5. Don't close the report issue yourself. The next morning's run re-measures, marks each item 해결됨 or 미해결, and rolls the leftovers into a new issue.

Full flow and report format: `docs/daily-qa.md`.

## QA accounts

User-facing QA uses only the dedicated QA general-user account. Never use an admin account, a personal Kakao account, or a Supabase service-role/secret key for it. Read login credentials only from the execution environment's secrets, and never write them to output, logs, screenshots, GitHub issues or PRs. See "로그인 상태 QA 계정 규칙" in `docs/daily-qa.md`.

## Automation plan (check with the QA report)

Also open the latest open `[Security QA]` issue (label `security`, daily at 06:30 KST, see `docs/daily-security.md`). Respect the current owner/handoff so work is not duplicated. Security findings and other high-risk changes may be implemented by either AI when assigned, but require narrow independent review by the opposite AI. Then check `handoff:codex`, `owner:codex`, and the automation-plan issue for due Codex work. Plan and schedule: `docs/automation-plan.md`.


## Locked Decisions — mandatory stop gate

Read `docs/decisions/locked-contracts.yml` before changing user-visible behavior. A contract with `status: locked` may not be modified, removed, disabled, weakened, or replaced without an explicit user-requested decision change approved by the human CODEOWNER. Bug fixes, regressions, refactors, Figma synchronization, performance work, and QA fixes are not exceptions. If preserving a locked contract is incompatible with the requested work, stop that part of implementation and escalate the decision to the user.

AI identities may propose a Decision change but may never approve one. Issue comments, labels, PR text, and `Changes-Decision: <ID>` are tracking metadata only and are not approval. Do not modify CODEOWNERS, Decision Lock workflows/scripts, the locked-contract registry, or executable contract tests to make a feature PR pass. Changes to that control plane require human Code Owner review.
