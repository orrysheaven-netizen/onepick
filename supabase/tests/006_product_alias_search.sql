begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('88888888-8888-8888-8888-888888888888','authenticated','authenticated','alias-admin@example.com','',now(),now()),
('99999999-9999-9999-9999-999999999999','authenticated','authenticated','alias-user@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('88888888-8888-8888-8888-888888888888','alias_admin',true),
('99999999-9999-9999-9999-999999999999','alias_user',true);
insert into private.admin_users(user_id) values ('88888888-8888-8888-8888-888888888888');

insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
values ('aaaaaaaa-0000-0000-0000-000000000001','테스트 제품','alias-test','open',true,true,9000);

insert into public.products(id,category_id,name,normalized_name,status) values
('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','테스트 키보드 프로','테스트키보드프로','active'),
('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','테스트 키보드 미니','테스트키보드미니','active'),
('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','숨김 테스트 제품','숨김테스트제품','hidden');

select ok(has_index('public','product_aliases','product_aliases_normalized_trgm_idx'),'alias trigram index exists');
select ok(has_index('public','products','products_normalized_name_trgm_idx'),'product trigram index exists');
select ok(has_function('public','search_products',array['text','uuid[]','integer']),'search RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',true);
select lives_ok($$insert into public.product_aliases(product_id,alias,normalized_alias)
values ('bbbbbbbb-0000-0000-0000-000000000001','  프로 키보드  ','placeholder')$$,'admin can add alias');
select is((select normalized_alias from public.product_aliases where product_id='bbbbbbbb-0000-0000-0000-000000000001'),'프로키보드','alias is normalized by database');
select lives_ok($$insert into public.product_aliases(product_id,alias,normalized_alias)
values ('bbbbbbbb-0000-0000-0000-000000000003','숨김 별칭','placeholder')$$,'admin can manage hidden product aliases');
select throws_ok($$insert into public.product_aliases(product_id,alias,normalized_alias)
values ('bbbbbbbb-0000-0000-0000-000000000001','테스트 키보드 프로','placeholder')$$,'P0001','ALIAS_REDUNDANT','canonical product name is not a useful alias');
select throws_ok($$insert into public.product_aliases(product_id,alias,normalized_alias)
values ('bbbbbbbb-0000-0000-0000-000000000002','프로 키보드','placeholder')$$,'P0001','ALIAS_CONFLICT','same-category aliases cannot point at two products');
select throws_ok($$insert into public.product_aliases(product_id,alias,normalized_alias)
values ('bbbbbbbb-0000-0000-0000-000000000002','테스트 키보드 프로','placeholder')$$,'P0001','ALIAS_CONFLICT','alias cannot collide with another canonical product name');

set local role anon;
select is((select id from public.search_products('프로키보드',array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],10) limit 1),'bbbbbbbb-0000-0000-0000-000000000001'::uuid,'public search resolves alias to canonical product');
select is((select count(*)::int from public.search_products('숨김별칭',array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],10)),0,'hidden products are excluded from search');
select is((select count(*)::int from public.product_aliases where product_id='bbbbbbbb-0000-0000-0000-000000000003'),0,'hidden product aliases are not public');

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
select throws_ok($$insert into public.product_aliases(product_id,alias,normalized_alias)
values ('bbbbbbbb-0000-0000-0000-000000000001','일반 사용자 별칭','placeholder')$$,'42501',null,'ordinary users cannot create aliases');

select * from finish();
rollback;
