# Agent rules for this repository

Read `CLAUDE.md` first. It holds the branching rule (`main` is the single trunk, PRs only, required CI checks) and the working-tree rule. Both apply to every agent, not only Claude.

## Working tree

The primary checkout is shared by several concurrent agent sessions. Never checkout, switch, commit, reset or stash there. Create your own worktree from `origin/main`, work and push from it, open the PR with `--head <branch>`, and remove the worktree after the merge. Uncommitted changes you find in the primary checkout belong to another session; leave them out of your commits.

## Role division

ChatGPT/Codex is the primary builder; Claude Code is the independent reviewer/QA. GitHub is the source of truth, and agents should not implement the same feature in parallel. See `docs/ai-role-division.md`.

## Daily QA report (check at the start of every session)

Claude Code files a QA report every morning at 07:00 KST as a GitHub issue titled `[Daily QA] YYYY-MM-DD` with the label `qa-report`. It covers errors and slowness that real users hit on the tester site. Before starting other work:

1. Open the most recent **open** issue labeled `qa-report` in `orrysheaven-netizen/onepick`. If there is none, continue normally.
2. Handle its "수정 요청" items in order, High first then Medium. Skip items marked `진행 중`; an open PR already covers them. Ask the user first only if an item conflicts with the task they gave you.
3. Open one PR against `main` per item. Include `Refs #<issue>` and the item title in the PR body, and meet the item's "완료 기준".
4. If an item is a false positive or can't be fixed, comment on the issue with the reason. Don't silently skip it.
5. Don't close the report issue yourself. The next morning's run re-measures, marks each item 해결됨 or 미해결, and rolls the leftovers into a new issue.

Full flow and report format: `docs/daily-qa.md`.

## QA accounts

User-facing QA uses only the dedicated QA general-user account. Never use an admin account, a personal Kakao account, or a Supabase service-role/secret key for it. Read login credentials only from the execution environment's secrets, and never write them to output, logs, screenshots, GitHub issues or PRs. See "로그인 상태 QA 계정 규칙" in `docs/daily-qa.md`.

## Automation plan (check with the QA report)

Also open the latest open `[Security QA]` issue (label `security`, daily at 06:30 KST, see `docs/daily-security.md`). Anything labeled `security-urgent` comes first, and security Medium and above come before new features. Then check the issue labeled `automation-plan` and take any unchecked item assigned to ChatGPT/Codex whose deadline has arrived. Don't implement items owned by Claude. Plan and schedule: `docs/automation-plan.md`.
