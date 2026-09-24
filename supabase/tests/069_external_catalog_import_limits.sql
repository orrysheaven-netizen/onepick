begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users(id,aud,role,created_at,updated_at)
values('f9700000-0000-4000-8000-000000000001','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed)
values('f9700000-0000-4000-8000-000000000001','catalog_quota_user',true);
insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('f9700000-0000-4000-8000-000000000010','Catalog quota','catalog-quota-test','open',true,true);

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
    'private.enforce_external_catalog_import_limit()',
    'execute'
  ),
  'authenticated clients cannot call the quota trigger function'
);

insert into public.items(
  category_id,name,normalized_name,status,created_by,external_source,external_id
)
select
  'f9700000-0000-4000-8000-000000000010',
  'Catalog import '||g,
  'catalogimport'||g,
  'active',
  'f9700000-0000-4000-8000-000000000001',
  'quota_fixture',
  g::text
from generate_series(1,20) g;

select is(
  (select used_count from private.external_catalog_import_limits
   where user_id='f9700000-0000-4000-8000-000000000001'),
  20,
  'first twenty new external items consume the rolling quota'
);

select throws_ok(
  $$insert into public.items(
      category_id,name,normalized_name,status,created_by,external_source,external_id
    ) values(
      'f9700000-0000-4000-8000-000000000010',
      'Catalog import 21','catalogimport21','active',
      'f9700000-0000-4000-8000-000000000001',
      'quota_fixture','21'
    )$$,
  'P0001',
  'RATE_LIMITED',
  'twenty-first external catalog item in 24 hours is rejected'
);

insert into public.items(
  category_id,name,normalized_name,status,created_by
) values(
  'f9700000-0000-4000-8000-000000000010',
  'Manual item outside catalog quota','manualoutsidequota','active',
  'f9700000-0000-4000-8000-000000000001'
);

select is(
  (select used_count from private.external_catalog_import_limits
   where user_id='f9700000-0000-4000-8000-000000000001'),
  20,
  'non-catalog item creation does not consume catalog quota'
);

update private.external_catalog_import_limits
set window_started_at=statement_timestamp()-interval '25 hours'
where user_id='f9700000-0000-4000-8000-000000000001';

insert into public.items(
  category_id,name,normalized_name,status,created_by,external_source,external_id
) values(
  'f9700000-0000-4000-8000-000000000010',
  'Catalog import reset','catalogimportreset','active',
  'f9700000-0000-4000-8000-000000000001',
  'quota_fixture','reset'
);

select is(
  (select used_count from private.external_catalog_import_limits
   where user_id='f9700000-0000-4000-8000-000000000001'),
  1,
  'catalog import quota resets after the rolling 24-hour window'
);

select * from finish();
rollback;
