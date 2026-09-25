begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users(id,aud,role,created_at,updated_at)
values('f9700000-0000-4000-8000-000000000001','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed)
values('f9700000-0000-4000-8000-000000000001','catalog_quota_user',true);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.external_catalog_import_limits',
    'select'
  ),
  'authenticated clients cannot inspect catalog import counters'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_external_catalog_import(uuid)',
    'execute'
  ),
  'authenticated clients cannot reserve catalog import quota directly'
);

set local role service_role;

select ok(
  (select bool_and(public.reserve_external_catalog_import(
    'f9700000-0000-4000-8000-000000000001'
  )) from generate_series(1,20)),
  'first twenty catalog import reservations in 24 hours are allowed'
);

reset role;

select is(
  (select used_count from private.external_catalog_import_limits
   where user_id='f9700000-0000-4000-8000-000000000001'),
  20,
  'the shared counter tracks total imports across providers'
);

set local role service_role;

select ok(
  not public.reserve_external_catalog_import(
    'f9700000-0000-4000-8000-000000000001'
  ),
  'twenty-first catalog import reservation in 24 hours is denied'
);

reset role;

update private.external_catalog_import_limits
set window_started_at=statement_timestamp()-interval '25 hours'
where user_id='f9700000-0000-4000-8000-000000000001';

set local role service_role;

select ok(
  public.reserve_external_catalog_import(
    'f9700000-0000-4000-8000-000000000001'
  ),
  'catalog import quota resets after the rolling 24-hour window'
);

reset role;

select is(
  (select used_count from private.external_catalog_import_limits
   where user_id='f9700000-0000-4000-8000-000000000001'),
  1,
  'reset window begins with one consumed reservation'
);

select * from finish();
rollback;
