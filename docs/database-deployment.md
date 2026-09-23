# Database deployment protection

Refs #225 (항목 9). App-authored PR #247 succeeds the closed, unmerged #245 and implements a separate human approval gate because
GitHub rejected native required environment reviewers on this private repository.
**Apply is disabled by default.** The reviewed configuration in
`tools/deploy/config.json` has `enabled: false`, no automation actor ID, and all
readiness conditions false. Do not enable it merely to make a workflow pass.

`Deploy Database Migrations` has three jobs: `plan` creates a successful immutable
preview artifact, `verify` checks approval without DB secrets, and dependent
`apply` rechecks the evidence and live DB state before consuming the approval.
Both DB-access jobs use the existing main-only `Production` environment. All
jobs check out the event's exact SHA; an approval for an older main is rejected.
The implementation and its limitations are described in
`docs/database-deployment-approval-design.md`.
The account transition and current configuration findings are recorded in
`docs/database-deployment-activation.md`.
The plan for preserving unrelated account connections while isolating OnePick
automation is in `docs/database-deployment-isolation.md`.

## Prerequisites before activation

1. Keep `Production` restricted to the selected **branch** `main`, not tags.
   Native required reviewers were rejected by GitHub's plan restrictions; this
   workflow gate does not provide native withholding of environment secrets.
2. Separate the automation identity from the human approver. The current agent
   connection and CLI both use `orrysheaven-netizen`; they cannot independently
   prove a human approval. The scoped App identity is verified, but a separate
   automation environment and approval-access boundary remain necessary. Preserve
   existing connections used by other work; do not globally log out or disconnect
   them. Exclude the human credential and equivalent approval capabilities from
   the OnePick automation runtime, and record its numeric actor ID in
   reviewed configuration. Both the apply dispatch actor and rerun actor must
   match it. The human must personally post approval from an allowlisted account.
3. Require human review of main changes, especially workflows, approval code,
   identities and configuration. No direct main pushes or admin bypass. Verify
   the protection actually applies; an unchecked setting is not evidence.
   The current required approval count is zero even though the three CI checks
   and admin enforcement are enabled. Establish a separate PR author and human
   reviewer before requiring one approval; the owner cannot approve owner-authored
   PR #245. That PR has been replaced by App-authored #247; user approval of
   App-authored #246 has verified the review route. Do not bypass protection.
4. Register `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` as **environment
   secrets** in `Production` using GitHub's secret UI or a trusted secret manager.
   Verify registration, then remove the repository-scoped copies. GitHub cannot
   return stored values for copying. Never put them in chat, logs or temporary
   files. As of preparation, Production has no secrets and the repository copies
   still exist; this prerequisite is not complete.
5. Bootstrap `20260923155002_add_database_deployment_approval_ledger.sql` with a
   reviewed normal migration run by the human using credentials outside the
   agent. Review and explicitly authorize the **entire** pending set first;
   approving this ledger alone does not authorize other pending migrations.
   Never alter `supabase_migrations.schema_migrations` or release a reservation
   to work around a failure. The ledger's absence blocks automated apply.
6. Establish exclusive schema control during deployment: pause or coordinate
   other SQL writers, repositories and integrations. A fresh preview and CLI
   apply are not one atomic database transaction.
7. Run the complete flow against a disposable target with its own reviewed
   configuration, credentials and ledger, including two simultaneous attempts
   to consume one approval. Verify the actual artifact download, CLI output and
   migration behavior. The included unit tests and DB tests do not establish
   that live end-to-end condition. Have a human verify the final protected flow.
8. Only after recording evidence for every readiness field, submit the numeric
   automation ID, readiness flags and `enabled: true` in a separately reviewed
   main PR. Keep this PR in Draft while the external prerequisites remain unmet.

QA separately needs a proven least-privilege `SUPABASE_QA_ACCESS_TOKEN` in the
main-only `daily-qa` environment. Its provider permissions must prohibit writes
and deployment. Until available, error aggregation explicitly skips while public
web checks continue. Do not reuse the deployment token for QA.

Settings: https://github.com/orrysheaven-netizen/onepick/settings/environments

## Deploy after activation

1. Run `mode=dry-run` on current main. A push affecting migrations or deployment
   code also creates a plan. Read the successful `plan` job summary and its
   `db-deployment-plan-<run>-<attempt>` artifact. Review the SHA, target, all
   pending SQL and history hashes. A pending set is a successful preview, not a
   drift-check failure. No migrations are applied by this mode.
2. Within 24 hours of the plan job completing, the designated human personally
   posts its exact generated approval statement in issue #225. Do not edit it.
   The agent must not post approval on the human's behalf. An empty plan needs
   no apply and cannot consume an approval.
3. The separate automation identity dispatches `mode=apply` on the same main
   SHA, supplying `preview_run_id` and `approval_comment_id`. The verifier needs
   no DB secrets. The dependent Production job revalidates current main, the
   comment, artifact, local SQL, live history and a pinned CLI dry-run.
4. An atomic insert into `private.database_deployment_approvals` commits the
   approval reservation before the CLI runs. Only one returned row permits
   apply. Failure, timeout or cancellation consumes the approval permanently if
   the insert committed. Inspect the result, then obtain a fresh plan and human
   approval; never delete the ledger row or reuse an uncertain approval.
5. Check the final history and no-pending result, Security Advisor, and logged-in
   user checks in #165. Keep feature PR #242 in Draft until that gate passes.
   Storage validation must reflect the 5 MiB policy from #233.

After DB restore/reset, suspend automated apply and invalidate all pre-restore
approvals before reactivation: restoring the DB can restore the replay ledger.

The client-error CHECKs from #244 intentionally remain `NOT VALID` until legacy
identifiers are remediated. They enforce new INSERT/UPDATE writes; correct
invalid identifiers before updating historical rows, including updates caused
by deleting their owning user.
