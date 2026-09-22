begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public','place_catalog','place_catalog exists');
select has_table('private','place_import_raw','private staging exists');
select has_table('private','place_import_runs','import run log exists');

select ok(
  has_table_privilege('anon','public.place_catalog','SELECT'),
  'anon can read the public catalog subject to RLS'
);
select ok(
  has_table_privilege('authenticated','public.place_catalog','SELECT'),
  'authenticated can read the public catalog subject to RLS'
);
select ok(
  not has_table_privilege('authenticated','public.place_catalog','INSERT'),
  'authenticated cannot write the provider catalog directly'
);
select ok(
  not has_table_privilege('authenticated','private.place_import_raw','SELECT'),
  'authenticated cannot read raw provider staging'
);
select ok(
  not has_function_privilege('authenticated','private.promote_place_imports(text)','EXECUTE'),
  'authenticated cannot execute import promotion'
);
select ok(
  not has_function_privilege('anon','private.promote_place_imports(text)','EXECUTE'),
  'anon cannot execute import promotion'
);
select ok(
  has_function_privilege('service_role','private.promote_place_imports(text)','EXECUTE'),
  'service_role can execute import promotion'
);

insert into private.place_import_raw(
  place_provider,provider_place_id,source_updated_at,payload
)
values
(
  'localdata','A-1','2026-09-22T00:00:00Z',
  '{"name":"테스트 곱창","road_address":"서울 테스트로 1","region_1":"서울","region_2":"강남구","latitude":"37.5","longitude":"127.0","provider_category":"한식","business_status":"open"}'
),
(
  'localdata','A-1','2026-09-21T00:00:00Z',
  '{"name":"오래된 이름","business_status":"closed"}'
);

set local role service_role;
select is(
  private.promote_place_imports('localdata'),
  1,
  'latest staging row is promoted once'
);
reset role;

select is(
  (select count(*)::integer
   from public.place_catalog
   where place_provider='localdata' and provider_place_id='A-1'),
  1,
  'provider identity is unique within the provider namespace'
);
select is(
  (select name
   from public.place_catalog
   where place_provider='localdata' and provider_place_id='A-1'),
  '테스트 곱창',
  'older row does not win'
);
select is(
  (select business_status
   from public.place_catalog
   where place_provider='localdata' and provider_place_id='A-1'),
  'open',
  'open status promoted'
);

insert into private.place_import_raw(
  place_provider,provider_place_id,source_updated_at,payload
)
values (
  'localdata','A-1','2026-09-23T00:00:00Z',
  '{"name":"테스트 곱창","road_address":"서울 테스트로 1","business_status":"closed"}'
);

set local role service_role;
select is(
  private.promote_place_imports('localdata'),
  1,
  'newer closed row updates provider catalog'
);
reset role;

select is(
  (select business_status
   from public.place_catalog
   where place_provider='localdata' and provider_place_id='A-1'),
  'closed',
  'closed is soft state, not delete'
);
select is(
  (select count(*)::integer
   from public.place_catalog
   where place_provider='localdata' and provider_place_id='A-1'),
  1,
  'closed place remains stored'
);

set local role anon;
select is(
  (select count(*)::integer
   from public.place_catalog
   where place_provider='localdata' and provider_place_id='A-1'),
  0,
  'anon cannot read closed provider records'
);
reset role;

select * from finish();
rollback;
