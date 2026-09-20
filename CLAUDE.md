# Branching

`main` is the single trunk. Base new branches on `main` and open PRs against `main`.

Do not create or target a long-lived integration branch (e.g. a `feature/*` branch meant to hold multiple unrelated PRs) instead of `main` — this repo has drifted that way before (`feature/pick-core` diverged from `main` by 100+ commits) and caused real deploy bugs: Supabase Edge Functions were deployed from a stale branch because the "production" branch and the branch people were actually merging into disagreed.

`main` is protected (no direct pushes, PRs required) and is the branch Supabase's GitHub integration deploys Edge Functions from on merge.

# Local database tests

`supabase db start` restores the existing `supabase_db_onepick` Docker volume
("Starting database from backup...") and does not apply migrations added since
the volume was created. Before `supabase test db`, run `supabase db reset` so
the schema matches `supabase/migrations`; otherwise pgTAP suites for newer
migrations fail with errors that look like validator bugs. See
`docs/development-start.md`.
