begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_table('public','place_catalog','place_catalog exists');
select has_table('private','place_import_raw','private staging exists');
select has_table('private','place_import_runs','import run log exists');

insert into private.place_import_raw(place_provider,provider_place_id,source_updated_at,payload)
values
('localdata','A-1','2026-09-22T00:00:00Z',
 '{"name":"테스트 곱창","road_address":"서울 테스트로 1","region_1":"서울","region_2":"강남구","latitude":"37.5","longitude":"127.0","provider_category":"한식","business_status":"open"}'),
('localdata','A-1','2026-09-21T00:00:00Z',
 '{"name":"오래된 이름","business_status":"closed"}');

set local role service_role;
select is(private.promote_place_imports('localdata'),1,'latest staging row is promoted once');
reset role;

select is((select count(*)::integer from public.place_catalog where place_provider='localdata' and provider_place_id='A-1'),1,'provider identity is unique');
select is((select name from public.place_catalog where place_provider='localdata' and provider_place_id='A-1'),'테스트 곱창','older row does not win');
select is((select business_status from public.place_catalog where place_provider='localdata' and provider_place_id='A-1'),'open','open status promoted');

insert into private.place_import_raw(place_provider,provider_place_id,source_updated_at,payload)
values ('localdata','A-1','2026-09-23T00:00:00Z',
 '{"name":"테스트 곱창","road_address":"서울 테스트로 1","business_status":"closed"}');

set local role service_role;
select is(private.promote_place_imports('localdata'),1,'newer closed row updates canonical catalog');
reset role;

select is((select business_status from public.place_catalog where place_provider='localdata' and provider_place_id='A-1'),'closed','closed is soft state, not delete');
select is((select count(*)::integer from public.place_catalog where place_provider='localdata' and provider_place_id='A-1'),1,'closed place remains stored');

select * from finish();
rollback;
