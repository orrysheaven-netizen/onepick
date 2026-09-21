# Agent rules for this repository

Read `CLAUDE.md` first. It holds the branching rule (`main` is the single trunk, PRs only, required CI checks) and the working-tree rule. Both apply to every agent, not only Claude.

## Working tree

The primary checkout is shared by several concurrent agent sessions. Never checkout, switch, commit, reset or stash there. Create your own worktree from `origin/main`, work and push from it, open the PR with `--head <branch>`, and remove the worktree after the merge. Uncommitted changes you find in the primary checkout belong to another session; leave them out of your commits.

## Role division

Codex is the builder; Claude Code is the independent reviewer/QA. See
`docs/ai-role-division.md` for the split and the review report format.
