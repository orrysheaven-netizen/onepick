# Branching

`main` is the single trunk. Base new branches on `main` and open PRs against `main`.

Do not create or target a long-lived integration branch (e.g. a `feature/*` branch meant to hold multiple unrelated PRs) instead of `main` — this repo has drifted that way before (`feature/pick-core` diverged from `main` by 100+ commits) and caused real deploy bugs: Supabase Edge Functions were deployed from a stale branch because the "production" branch and the branch people were actually merging into disagreed.

`main` is protected (PRs required; `typecheck`, `verify-web` and `database-tests` must pass; no admin bypass) and is the branch Supabase's GitHub integration deploys Edge Functions from and Cloudflare Pages builds the tester site from on merge.

# Working tree

Several agent sessions (Claude Code, ChatGPT/Codex) work on this repository at the same time. The primary checkout (the `onepick` folder itself) is shared, so treat it as read-only:

- **Never `git checkout`, `git switch`, `git commit`, `git reset` or `git stash` in the primary checkout.** Another session may be mid-edit there; switching its branch has already put one session's commit onto another session's branch.
- Do all work in your own worktree: `git worktree add <path> -b <branch> origin/main` (Claude Code sessions can use the app's `.claude/worktrees` location). Push from that worktree and open the PR from there (`gh pr create --head <branch>`).
- Remove your worktree when the PR is merged (`git worktree remove <path>`). Don't remove or reset worktrees you didn't create.
- `mobile/node_modules` is large; link it into a worktree instead of reinstalling (Windows PowerShell: `New-Item -ItemType Junction -Path <worktree>/mobile/node_modules -Target <primary>/mobile/node_modules`), and unlink it (`(Get-Item <worktree>/mobile/node_modules).Delete()`) before removing the worktree so the real folder is untouched.
- Uncommitted changes you find in the primary checkout belong to someone else. Leave them alone and don't include them in your commits.


# Local database tests

Before `supabase test db`, make sure the restored local database has every migration from the current branch:

```bash
supabase migration up --local --include-all
supabase test db
```

An existing local Docker volume can be behind the migration files after a pull or branch change. `migration up --local --include-all` applies migrations missing from the local migration history without rebuilding the database. Do not use `supabase stop --no-backup` just to catch up migrations; that removes local data. See `docs/development-start.md`.

# Role division

ChatGPT/Codex is the primary builder for feature implementation, migrations, and deployment work. Claude Code is the independent reviewer/QA and should avoid duplicating feature work already owned by the builder. GitHub `main`, PRs, migrations, and test results are the source of truth. See `docs/ai-role-division.md`.
