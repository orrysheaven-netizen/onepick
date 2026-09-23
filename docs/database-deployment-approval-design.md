# DB deployment approval without native environment reviewers

Status: **implemented, disabled pending external activation prerequisites**. The user selected a
separate approval design after GitHub rejected native required reviewers on
this private repository. The App-authored successor PR #247 must remain Draft until identity separation,
credential migration and the activation tests below are complete. This document does not
authorize a deployment or replace an approval with a workflow input.

## Operator flow

1. A `main` preview produces an immutable deployment plan: exact commit,
   Supabase project, ordered pending migrations, file hashes and the observed
   remote migration history. Its Actions run contains the plan artifact and
   shows a generated, single-line approval statement.
2. The designated human reviews that plan and personally posts the exact
   statement in the repository's designated DB approval issue. Neither an
   agent nor a workflow may generate an approval comment on the human's behalf.
   Preparing the statement as data is allowed; publishing approval is not.
3. The separate automation identity starts apply with only the preview run ID and approval comment
   ID. A job without database credentials checks the evidence. Invalid or
   missing evidence stops the run before the deployment job starts.
4. The `Production` job rechecks the evidence and the live pending plan,
   reserves that approval once, then applies the approved commit. It records
   the result and verifies there are no remaining migrations for that plan.
   A changed plan requires a new preview and approval.

No issue-comment workflow runs arbitrary commands. Comments are strictly parsed
data fetched by a manually dispatched workflow from `main`.

## Approval identity is a prerequisite

The legacy agent connection and GitHub CLI still have access as `orrysheaven-netizen`,
the same account that would approve. App-scoped PR and dispatch operations have
been verified, but they do not remove those legacy capabilities. A comment's author cannot prove whether the
human or an agent using that account wrote it. Therefore **a same-account
comment is insufficient as an independent approval gate**.

Before enabling this design, separate the automation identity from the human
approver. Use a dedicated automation account/GitHub App with scoped permissions
for code and workflow operations; keep the human approver's credential out of
the automation runtime. Existing connections used by other work are not to be
globally disconnected as part of this transition. Follow
`docs/database-deployment-isolation.md`: a separate runner alone is insufficient
while an agent can still publish OnePick approvals as the allowlisted human.
Record the actual credential/access boundary before marking identity separation
complete. Store approved numeric GitHub user IDs in reviewed main
configuration and reject bots and the requesting automation identity.

Changes to approval code, approved identities and deployment workflows also
need human review under main branch protection. No admin bypass or direct main
push is allowed. If identities cannot be separated, keep apply disabled and
choose a separately reviewed external signing/approval system. Do not claim
that a manual dispatch or an actor-name check supplies this separation.

## Bound approval data

The plan has a versioned, canonical JSON schema. Its SHA-256 covers:

- repository ID and full name;
- target project reference and fixed deployment environment;
- full commit SHA, preview workflow ID/path, run ID and run attempt, and pinned
  Supabase CLI version;
- sorted/ordered migration versions and SHA-256 of each SQL file;
- canonical remote migration-history baseline and pending migration list.

Use a single generated statement with an exact grammar, for example:

```text
APPROVE_DB_DEPLOY v1 repo=<owner/repo> project=<project-ref> sha=<40-hex> run=<id> attempt=<n> plan=<64-hex>
```

The approval is valid for 24 hours after the preview completes. The verifier
fetches the comment through GitHub's API and checks the designated issue,
allowlisted numeric user ID, account type, exact statement, creation time after
the preview and no edits (`updated_at == created_at`). Missing/deleted comments,
edited comments and partial matches fail closed. Never interpolate comment
text, issue titles or artifact strings into shell code.

## Verification and replay protection

- A dedicated successful `plan` job/artifact replaces the previous deliberately
  failing drift check. Arbitrary failed preview runs do not qualify as evidence.
- Accept only a successful plan from the configured workflow in this
  repository, triggered on `main` by push or manual dispatch. The run attempt
  and artifact must be the exact approved ones. Reject PR/fork artifacts,
  expired artifacts, unknown schema fields, oversized data and unknown paths.
  Verify artifact ID/digest against GitHub metadata as well as the canonical
  plan hash. Reject duplicate keys. Downloaded artifacts are data and are never
  executed.
- Check the full approved SHA is still `main` at verification and immediately
  before apply. Check out that SHA with persisted credentials disabled; never
  fetch a moving branch for deployment. Recompute migration hashes from the
  checked-out files and compare a fresh live preview and history to the plan.
- Give the first verifier only `contents: read`, `actions: read`, and
  `issues: read`; it has no Supabase secrets. Expose deployment secrets only
  to the dependent main-only `Production` job. Do not run untrusted PR code or
  artifact-provided scripts in that job.
- Serialize verification, reservation and apply under one repository DB
  deployment concurrency group with cancellation disabled. Atomically reserve
  `(repository_id, approval_comment_id)` in a restricted private DB ledger with
  a UNIQUE key; save the plan hash, target, SHA, preview identity and apply run
  identity. Commit the reservation separately before invoking the migration
  CLI, so a failed migration cannot roll it back. Reserve with `INSERT ... ON
  CONFLICT DO NOTHING RETURNING` and require exactly one returned row. Explicitly
  deny `PUBLIC`, `anon`, `authenticated` and `service_role` access, including
  inherited/default grants; RLS alone is insufficient. Provide no public RPC
  path. Only the protected deployment credential may reserve approvals; do not
  expose that credential to other branches.
- Reject any already-reserved approval, including failed or interrupted
  deployments. An uncertain result requires inspecting the DB, then issuing a
  fresh preview and human approval. Workflow reruns cannot reuse approval.
  A ledger read/write failure or ambiguous reservation response also blocks
  apply. Never delete or release a reservation as a retry mechanism.
- Bootstrap the ledger through its own reviewed normal migration, applied
  once by the human operator using credentials unavailable to the agent, before
  enabling automated apply. Do not bypass approval to bootstrap it or edit
  migration-history rows. The human must review the complete initial pending
  set; approving the ledger must not implicitly authorize other pending
  migrations. Record that bootstrap as part of the activation checklist.
- GitHub Deployment records can additionally provide audit links, using
  `auto_merge: false`, the exact SHA and minimum `deployments: write` permission.
  They are **not** the authoritative consumption ledger: they are deletable,
  lack a uniqueness guarantee, and another branch workflow may obtain
  `deployments: write`. Deleting a GitHub audit record must never enable replay.
- Check comment existence/content again just before reservation. Reservation
  is the cutoff for cancellation; editing or deleting a comment after SQL
  execution starts cannot roll back a transaction. Do not promise revocation
  of an already-running deployment.

## Scope and remaining limits

This is a workflow-enforced gate. It does not provide GitHub's native guarantee
that an environment withholds secrets until a platform reviewer approves.
Main-only environment restrictions, removal of repository-scoped deployment
secrets, protected workflow changes and separate approver credentials are all
required. A compromised repository administrator or approver remains outside
this gate's protection boundary.

A database restore/reset can roll back the private ledger too. Suspend
automated apply after a restore and invalidate all pre-restore approvals before
re-enabling it.

GitHub concurrency does not lock manual SQL, another repository or an external
Supabase integration. A fresh dry-run followed by a CLI apply is not one atomic
database operation. Other schema writers must be disabled or coordinated for
the deployment window; a cooperative advisory lock alone cannot restrain an
uncooperative writer. Migration-history equality also does not prove there was
no out-of-band schema edit. If exclusive schema control cannot be established,
block automated apply and use a separately supervised deployment.

`Production` is already restricted to branch `main`, but its secrets are not
registered. `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` still need safe
environment registration followed by removal of the repository copies. QA
also needs its own proven least-privilege credential. No stored secret values
can be recovered through GitHub's secrets API.

## Implementation acceptance tests

The pure policy, runtime-boundary and apply-order tests run in Mobile CI using
`node --test tools/deploy/*.test.mjs`. The private ledger's constraints, role
access and one-use reservation are covered by
`supabase/tests/067_database_deployment_approvals.sql` in Database Tests.
That workflow also runs `node tools/deploy/ledger.integration.mjs` against only
its disposable local PostgreSQL server at `127.0.0.1:54322`. Separate real
connections contend on one approval; the test observes a transaction lock,
then verifies exactly one committed reservation, rejection across plan/target
changes, persistence after a separate failed transaction, and application-role
access denial. It removes only its own synthetic fixture. No production token
or configurable connection URL is accepted. This tests the reservation's
transaction boundary, not a remote Supabase CLI apply or human identity flow.
Full disposable-target and human-flow verification remain activation conditions
in `tools/deploy/config.json`; unit tests must not set those flags automatically.

1. A fresh approval for the exact plan passes; no approval stops before any
   database-secret job starts.
2. Wrong author/identity, bot, wrong issue/repository/project, edited/deleted
   comment, invalid grammar and expired approval all fail.
3. A changed main SHA, changed SQL content, changed remote migration history,
   changed pending list or mismatched/expired/fork artifact all require a new
   preview and approval.
4. Reuse, rerun and simultaneous apply requests cannot consume one approval
   twice. Ledger errors fail closed, failed migrations leave reservations
   consumed, and deletion of a GitHub Deployment audit record cannot permit
   reuse.
5. Injection-shaped inputs cannot affect commands, paths or workflow control.
   Secrets never appear in summaries, artifacts, comments or test output.
6. Test dry-run and apply against a disposable database first. A human verifies
   the final protected flow before the first live apply. Then recheck #165's
   Security Advisor and logged-in user smoke tests; #242 remains Draft until
   that stabilization gate is satisfied.

## API references

- [Issue-comment identity and timestamps](https://docs.github.com/en/rest/issues/comments#get-an-issue-comment)
- [Artifacts associated with a workflow run](https://docs.github.com/en/rest/actions/artifacts#list-workflow-run-artifacts)
- [Deployment records and payloads](https://docs.github.com/en/rest/deployments/deployments#create-a-deployment)
- [Atomic reservation with INSERT](https://www.postgresql.org/docs/current/sql-insert.html)
- [Supabase database roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Environment protection and plan availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
