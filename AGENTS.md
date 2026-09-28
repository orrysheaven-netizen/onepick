# Shared priority rules

Before any OnePick work, read `docs/shared-working-rules.md` first. It contains the user's latest common rules for both ChatGPT/Codex and Claude. If it conflicts with older discussions or repository guidance, follow the newer user-approved document or instruction.

# Agent rules for this repository

Read `CLAUDE.md` first. It holds the branching rule (`main` is the single trunk, PRs only, required CI checks) and the working-tree rule. Both apply to every agent, not only Claude.

## Working tree

The primary checkout is shared by several concurrent agent sessions. Never checkout, switch, commit, reset or stash there. Create your own worktree from `origin/main`, work and push from it, open the PR with `--head <branch>`, and remove the worktree after the merge. Uncommitted changes you find in the primary checkout belong to another session; leave them out of your commits.

## Role division

ChatGPT/Codex is the **default Product / Technical Owner and work coordinator**. Claude Code specializes in **Platform / Reliability, QA, and independent review**, and may implement work explicitly delegated by the user or the handoff queue. Workload is tracked by `size:S/M/L` points with a 60:40 Codex:Claude target. Temporary delegation to Claude (including delegation caused by GPT usage limits or availability) does not change the default authority model. High-risk changes require cross-review and user approval gates regardless of who implements them. GitHub is the source of truth, and agents must not implement the same feature in parallel. See `docs/ai-role-division.md`.

At session start, read the `[AI Ops] OnePick 작업·인계 대시보드` issue first, then your `handoff:*` issues, then only the referenced task/PR. Avoid broad repository rereads unless the task requires them.

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
