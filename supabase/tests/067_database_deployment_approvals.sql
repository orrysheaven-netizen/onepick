begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select ok((select relrowsecurity from pg_class
  where oid = 'private.database_deployment_approvals'::regclass),
  'approval ledger enables RLS as defense in depth');
select is((select count(*)::int from pg_policies
  where schemaname = 'private' and tablename = 'database_deployment_approvals'),
  0, 'approval ledger has no application access policies');
select is((select count(*)::int
  from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.oid = 'private.database_deployment_approvals'::regclass and a.grantee = 0),
  0, 'PUBLIC has no ledger table privileges');

-- has_table_privilege includes grants inherited via PUBLIC and role membership.
-- The bypass-RLS service role must fail this check just like client roles.
select ok(not has_table_privilege(role_name,
  'private.database_deployment_approvals', privilege_name),
  role_name || ' cannot ' || privilege_name || ' the approval ledger')
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
  ('REFERENCES'), ('TRIGGER')) privileges(privilege_name);
select ok(not has_any_column_privilege(role_name,
  'private.database_deployment_approvals', 'SELECT,INSERT,UPDATE,REFERENCES'),
  role_name || ' has no column-level ledger access')
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);

with reservation as (
  insert into private.database_deployment_approvals (
    repository_id, approval_comment_id, plan_hash, project_ref, commit_sha,
    preview_run_id, preview_run_attempt, apply_run_id, apply_run_attempt
  ) values (980000001, 980000001, repeat('a',64), repeat('a',20), repeat('a',40),
    980000001, 1, 980000002, 1)
  on conflict (repository_id, approval_comment_id) do nothing
  returning approval_comment_id
)
select is((select count(*)::int from reservation), 1,
  'first protected reservation returns exactly one row');
select ok((select reserved_at = transaction_timestamp()
  from private.database_deployment_approvals
  where repository_id = 980000001 and approval_comment_id = 980000001),
  'reservation records the database timestamp by default');

with reservation as (
  insert into private.database_deployment_approvals (
    repository_id, approval_comment_id, plan_hash, project_ref, commit_sha,
    preview_run_id, preview_run_attempt, apply_run_id, apply_run_attempt
  ) values (980000001, 980000001, repeat('a',64), repeat('a',20), repeat('a',40),
    980000001, 1, 980000002, 2)
  on conflict (repository_id, approval_comment_id) do nothing
  returning approval_comment_id
)
select is((select count(*)::int from reservation), 0,
  'workflow rerun cannot consume the same comment again');
with reservation as (
  insert into private.database_deployment_approvals (
    repository_id, approval_comment_id, plan_hash, project_ref, commit_sha,
    preview_run_id, preview_run_attempt, apply_run_id, apply_run_attempt
  ) values (980000001, 980000001, repeat('b',64), repeat('b',20), repeat('b',40),
    980000003, 1, 980000004, 1)
  on conflict (repository_id, approval_comment_id) do nothing
  returning approval_comment_id
)
select is((select count(*)::int from reservation), 0,
  'changing project, plan, SHA and runs cannot reuse the same approval');
select results_eq($$
  select plan_hash, project_ref, commit_sha, apply_run_attempt
  from private.database_deployment_approvals
  where repository_id = 980000001 and approval_comment_id = 980000001
$$, $$values (repeat('a',64), repeat('a',20), repeat('a',40), 1)$$,
  'replay attempts leave the original reservation unchanged');
select throws_ok($$
  insert into private.database_deployment_approvals (
    repository_id, approval_comment_id, plan_hash, project_ref, commit_sha,
    preview_run_id, preview_run_attempt, apply_run_id, apply_run_attempt
  ) values (980000001, 980000001, repeat('b',64), repeat('b',20), repeat('b',40),
    980000003, 1, 980000004, 1)
$$, '23505', null, 'a plain duplicate INSERT fails at the database unique key');

-- Exercise actual operations, not just catalog ACLs, including service_role
-- whose bypass-RLS property would otherwise make RLS-only protection useless.
set local role anon;
select throws_ok($$select * from private.database_deployment_approvals$$,
  '42501', null, 'anon cannot read approvals');
select throws_ok($$insert into private.database_deployment_approvals
  select * from private.database_deployment_approvals where false$$,
  '42501', null, 'anon cannot reserve approvals');
select throws_ok($$delete from private.database_deployment_approvals$$,
  '42501', null, 'anon cannot release approvals');
reset role;
set local role authenticated;
select throws_ok($$select * from private.database_deployment_approvals$$,
  '42501', null, 'authenticated cannot read approvals');
select throws_ok($$insert into private.database_deployment_approvals
  select * from private.database_deployment_approvals where false$$,
  '42501', null, 'authenticated cannot reserve approvals');
select throws_ok($$update private.database_deployment_approvals set plan_hash = repeat('b',64)$$,
  '42501', null, 'authenticated cannot alter approvals');
select throws_ok($$delete from private.database_deployment_approvals$$,
  '42501', null, 'authenticated cannot release approvals');
reset role;
set local role service_role;
select throws_ok($$select * from private.database_deployment_approvals$$,
  '42501', null, 'service_role cannot read approvals despite bypassing RLS');
select throws_ok($$insert into private.database_deployment_approvals
  select * from private.database_deployment_approvals where false$$,
  '42501', null, 'service_role cannot reserve approvals despite bypassing RLS');
select throws_ok($$update private.database_deployment_approvals set plan_hash = repeat('b',64)$$,
  '42501', null, 'service_role cannot alter approvals');
select throws_ok($$delete from private.database_deployment_approvals$$,
  '42501', null, 'service_role cannot release approvals');
select throws_ok($$truncate private.database_deployment_approvals$$,
  '42501', null, 'service_role cannot reset the replay ledger');
reset role;

-- Every binding is required, strictly shaped and bounded by its PostgreSQL
-- numeric type. jsonb_populate_record lets each case change one field while
-- all other columns retain a valid fixture, including reserved_at.
select throws_ok(format($sql$
  insert into private.database_deployment_approvals
  select (jsonb_populate_record(null::private.database_deployment_approvals,
    to_jsonb(existing) || jsonb_build_object(%L, %L::jsonb))).*
  from private.database_deployment_approvals existing
  where repository_id = 980000001 and approval_comment_id = 980000001
$sql$, field, value::text), '23514', null, field || ' rejects ' || description)
from (values
  ('repository_id','0'::jsonb,'zero'),
  ('repository_id','-1'::jsonb,'negative IDs'),
  ('approval_comment_id','0'::jsonb,'zero'),
  ('preview_run_id','0'::jsonb,'zero'),
  ('apply_run_id','0'::jsonb,'zero'),
  ('preview_run_attempt','0'::jsonb,'zero'),
  ('apply_run_attempt','0'::jsonb,'zero'),
  ('plan_hash',to_jsonb(repeat('a',63)),'short hashes'),
  ('plan_hash',to_jsonb(repeat('a',65)),'long hashes'),
  ('plan_hash',to_jsonb(repeat('A',64)),'noncanonical uppercase hashes'),
  ('plan_hash',to_jsonb(repeat('g',64)),'nonhex characters'),
  ('plan_hash',to_jsonb(repeat('a',64) || E'\n'),'trailing newlines'),
  ('commit_sha',to_jsonb(repeat('a',39)),'short SHAs'),
  ('commit_sha',to_jsonb(repeat('a',41)),'long SHAs'),
  ('commit_sha',to_jsonb(repeat('A',40)),'noncanonical uppercase SHAs'),
  ('commit_sha',to_jsonb(repeat('g',40)),'nonhex characters'),
  ('project_ref',to_jsonb(repeat('a',19)),'short project references'),
  ('project_ref',to_jsonb(repeat('a',21)),'long project references'),
  ('project_ref',to_jsonb(repeat('A',20)),'uppercase project references'),
  ('project_ref',to_jsonb(repeat('a',19) || ';'),'punctuation'),
  ('project_ref',to_jsonb(repeat('a',20) || E'\n'),'trailing newlines')
) rejected(field,value,description);
select throws_ok(format($sql$
  insert into private.database_deployment_approvals
  select (jsonb_populate_record(null::private.database_deployment_approvals,
    to_jsonb(existing) || jsonb_build_object(%L, null))).*
  from private.database_deployment_approvals existing
  where repository_id = 980000001 and approval_comment_id = 980000001
$sql$, field), '23502', null, field || ' is required')
from (values ('repository_id'), ('approval_comment_id'), ('plan_hash'), ('project_ref'),
  ('commit_sha'), ('preview_run_id'), ('preview_run_attempt'), ('apply_run_id'),
  ('apply_run_attempt'), ('reserved_at')) fields(field);

select * from finish();
rollback;
