# Database deployment protection

Refs #225 (항목 9). `Deploy Database Migrations` deploys only from `main` and
binds both dry-run and apply to the existing `Production` environment. Both
modes currently use the same write-capable credentials, so both need the
environment protections. A manual workflow dispatch alone is not an approval.

## Required configuration before merging or applying

1. In repository **Settings → Environments → Production**, allow only the
   `main` branch (selected branches, type **branch**, not tags).
2. Configure required deployment reviewers. Confirm that a run waits for
   approval before any job step can access secrets. Do not bypass this gate.
   GitHub limits required reviewers on private repositories by plan; if the
   setting is rejected, keep this change in Draft and do not run apply. Choose
   a supported protected environment or separately review an equivalent
   approval design before proceeding. Do not make the repository public to
   unlock the feature.

   After the native reviewer setting was rejected, the user selected the
   separate design in `docs/database-deployment-approval-design.md`. That gate
   is **not implemented** by this PR. Identity separation, implementation and
   its acceptance tests are prerequisites; the existing `mode=apply` input is
   not a replacement for approval.
3. Register `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` as **environment
   secrets** in `Production`. Re-enter the original values directly in GitHub's
   secret UI or use a trusted local secret manager. GitHub cannot return stored
   secret values for copying. Never print values in Actions logs, issues, chat,
   or a temporary file.
4. Provision a separate least-privilege QA credential as
   `SUPABASE_QA_ACCESS_TOKEN` in the `daily-qa` environment, which also allows
   only `main`. Confirm its actual provider permissions prohibit writes and
   deployment; a name or a read-only request URL does not reduce permissions.
   Until this credential is available, Daily QA explicitly skips error
   aggregation while its public web checks continue.
5. After verifying the two deployment secrets exist in `Production`, remove
   the repository-scoped copies. Environment names in YAML do not prevent a
   different branch from using repository secrets. Confirm no deployment
   credentials remain at repository scope before merging this change.

Settings: https://github.com/orrysheaven-netizen/onepick/settings/environments

GitHub's plan restrictions and environment behavior:
https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments

## Deploy and verify

1. Merge the reviewed workflow PR with all required checks passing. Run a
   protected dry-run on `main` and review every pending migration, including
   migrations merged by other sessions. A drift failure means migrations are
   pending; it does not mean deployment credentials are missing.
2. Dispatch `mode=apply` on the intended `main` commit. The job checks out the
   event's exact `github.sha`, so advancing `main` while approval is pending
   cannot silently change the migrations being approved. Verify that SHA is
   still the intended deployment before approving the run.
3. A designated reviewer approves the environment deployment after inspecting
   the pending migration list. The job applies migrations using the normal
   Supabase CLI and checks history and dry-run output again. Never edit
   `supabase_migrations.schema_migrations` directly.
4. Confirm no pending migrations remain, run Security Advisor, and perform the
   logged-in user checks listed in stabilization issue #165. Keep feature PR
   #242 in Draft until those conditions are satisfied. Storage validation must
   reflect the newer 5 MiB security policy from #233; do not blindly restore
   the older unrestricted-upload proposal.

The new client-error CHECKs from #244 intentionally remain `NOT VALID` until
legacy identifiers are remediated. They still enforce new INSERT/UPDATE writes;
correct invalid identifiers before updating historical rows, including updates
caused by deleting their owning user.
