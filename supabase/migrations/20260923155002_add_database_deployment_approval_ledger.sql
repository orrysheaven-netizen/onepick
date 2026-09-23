-- A reservation consumes a human approval permanently, even if the subsequent
-- migration command fails. The protected deployment process must commit its
-- INSERT ... ON CONFLICT DO NOTHING RETURNING in a separate request before
-- applying migrations and must require exactly one returned row.
create table private.database_deployment_approvals (
  repository_id bigint not null check (repository_id > 0),
  approval_comment_id bigint not null check (approval_comment_id > 0),
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  project_ref text not null check (project_ref ~ '^[a-z0-9]{20}$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  preview_run_id bigint not null check (preview_run_id > 0),
  preview_run_attempt integer not null check (preview_run_attempt > 0),
  apply_run_id bigint not null check (apply_run_id > 0),
  apply_run_attempt integer not null check (apply_run_attempt > 0),
  reserved_at timestamptz not null default now(),
  primary key (repository_id, approval_comment_id)
);

-- Do not include the plan/project/run in the unique key: changing any of them
-- must never permit reuse of an already-consumed repository comment.
comment on table private.database_deployment_approvals is
  'Append-only deployment approval reservations. Never update, delete, or release a reservation for retry; obtain a new human approval instead. Bootstrap through a reviewed migration before enabling automated apply.';

-- This schema is shared with existing RPC implementations whose callers need
-- schema USAGE. Keep those grants/defaults intact and revoke this table's
-- privileges after CREATE, including any supplied by creator default grants.
-- No public RPC or application role receives a reservation path.
revoke all privileges on table private.database_deployment_approvals
  from public, anon, authenticated, service_role;
alter table private.database_deployment_approvals enable row level security;
