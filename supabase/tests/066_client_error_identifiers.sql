begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- Save the actual migration's definitions so the legacy-data test below does
-- not duplicate its regex or accidentally test different constraints.
create temporary table identifier_constraints as
select conname, pg_get_constraintdef(oid) as definition, convalidated
from pg_constraint
where conrelid = 'public.client_error_events'::regclass
  and contype = 'c'
  and conname in (
    'client_error_events_context_identifier_check',
    'client_error_events_error_code_identifier_check',
    'client_error_events_platform_identifier_check'
  );

select is((select count(*)::int from identifier_constraints), 3,
  'all three identifier CHECK constraints exist');
select is((select count(*)::int from identifier_constraints where not convalidated), 3,
  'all three constraints are NOT VALID for deployment over legacy rows');

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values ('f9800000-0000-4000-8000-000000000001','authenticated','authenticated',
  'error-identifiers@example.invalid','',now(),now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f9800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);

select lives_ok(format(
  'insert into public.client_error_events(user_id,context,error_code,platform)
   values (%L,%L,%L,%L)',
  'f9800000-0000-4000-8000-000000000001', context, error_code, platform), description)
from (values
  ('root_error_boundary','UNEXPECTED_ERROR','ios','existing iOS error identifiers remain valid'),
  ('item_photo_upload','NETWORK_ERROR','android','existing Android error identifiers remain valid'),
  ('request_item_photo_import','ITEM_NOT_FOUND','web','existing web error identifiers remain valid'),
  ('Az09_:./-','Az09_:./-','Az09_:./-','the full report-safe identifier alphabet is accepted'),
  ('a','0','w','single-character identifiers are accepted'),
  (repeat('a',80),repeat('Z',80),repeat('w',24),'existing maximum lengths are accepted'),
  ('unknown','UNEXPECTED_ERROR',null,'platform remains nullable')
) as accepted(context,error_code,platform,description);

-- Direct authenticated writes must reject free text without relying on the
-- client sanitizer or QA output filter. Exercise each field independently.
select throws_ok(format(
  'insert into public.client_error_events(user_id,context,error_code,platform)
   values (%L,%L,%L,%L)',
  'f9800000-0000-4000-8000-000000000001',
  case when field = 'context' then value else 'root_error_boundary' end,
  case when field = 'error_code' then value else 'UNEXPECTED_ERROR' end,
  case when field = 'platform' then value else 'web' end),
  '23514', null, field || ' rejects ' || description)
from (values ('context'),('error_code'),('platform')) as fields(field)
cross join (values
  ('','empty strings'),
  ('free text','spaces'),
  (' leading','leading whitespace'),
  ('trailing ','trailing whitespace'),
  (E'line\nbreak','embedded newlines'),
  (E'identifier\n','trailing newlines'),
  (E'identifier\r','carriage returns'),
  (E'tab\tvalue','tabs'),
  ('@mention','mentions'),
  ('table|cell','Markdown table separators'),
  ('`code`','Markdown code markers'),
  ('[link](url)','Markdown links'),
  ('<tag>','HTML markers'),
  ('한글','non-ASCII text'),
  ('café','accented letters'),
  ('a\\b','backslashes'),
  (repeat('a',81),'overlong identifiers')
) as rejected(value,description);

select throws_ok(
  $$insert into public.client_error_events(user_id,context,error_code,platform)
    values ('f9800000-0000-4000-8000-000000000001','root_error_boundary','UNEXPECTED_ERROR',repeat('w',25))$$,
  '23514', null, 'platform retains its 24-character limit');
select throws_ok(
  $$insert into public.client_error_events(user_id,context,error_code)
    values ('f9800000-0000-4000-8000-000000000001',null,'UNEXPECTED_ERROR')$$,
  '23502', null, 'context remains required');
select throws_ok(
  $$insert into public.client_error_events(user_id,context,error_code)
    values ('f9800000-0000-4000-8000-000000000001','root_error_boundary',null)$$,
  '23502', null, 'error_code remains required');
reset role;

-- UPDATE is intentionally tested as the owner: clients only have INSERT/SELECT.
select throws_ok(format(
  'update public.client_error_events set %I = %L where user_id = %L',
  field, 'free text', 'f9800000-0000-4000-8000-000000000001'),
  '23514', format('new row for relation "client_error_events" violates check constraint "%s"', constraint_name),
  field || ' is enforced on privileged updates too')
from (values
  ('context','client_error_events_context_identifier_check'),
  ('error_code','client_error_events_error_code_identifier_check'),
  ('platform','client_error_events_platform_identifier_check')
) as fields(field,constraint_name);

-- Simulate a deployment with values allowed by the old length-only checks.
-- All schema/data changes are rolled back at the end of this test.
alter table public.client_error_events
  drop constraint client_error_events_context_identifier_check,
  drop constraint client_error_events_error_code_identifier_check,
  drop constraint client_error_events_platform_identifier_check;
insert into public.client_error_events(id,user_id,context,error_code,platform)
values ('f9800000-0000-4000-8000-000000000002',
  'f9800000-0000-4000-8000-000000000001','legacy free text','legacy error','legacy platform');

select lives_ok($$
  do $constraints$
  declare
    saved record;
  begin
    for saved in select conname, definition from identifier_constraints loop
      execute format('alter table public.client_error_events add constraint %I %s',
        saved.conname, saved.definition);
    end loop;
  end;
  $constraints$;
$$, 'actual migration constraints can be added with incompatible legacy rows');

select is((select context from public.client_error_events
  where id = 'f9800000-0000-4000-8000-000000000002'),
  'legacy free text', 'deployment preserves historical rows without rewriting them');
select throws_ok(
  $$insert into public.client_error_events(context,error_code,platform)
    values ('legacy free text','legacy error','legacy platform')$$,
  '23514', null, 'new invalid rows are rejected while legacy rows still exist');
select throws_ok(
  $$update public.client_error_events set app_version = '1.0.1'
    where id = 'f9800000-0000-4000-8000-000000000002'$$,
  '23514', null, 'even unrelated updates must remediate invalid legacy identifiers');
select lives_ok(
  $$update public.client_error_events
    set context = 'legacy_context', error_code = 'LEGACY_ERROR', platform = null
    where id = 'f9800000-0000-4000-8000-000000000002'$$,
  'legacy rows can be corrected to valid identifiers');

select * from finish();
rollback;
