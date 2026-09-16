begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('55555555-5555-5555-5555-555555555555','authenticated','authenticated','shared-a@example.com','',now(),now()),
('66666666-6666-6666-6666-666666666666','authenticated','authenticated','shared-b@example.com','',now(),now()),
('77777777-7777-7777-7777-777777777777','authenticated','authenticated','shared-admin@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('55555555-5555-5555-5555-555555555555','shared_a',true),
('66666666-6666-6666-6666-666666666666','shared_b',true),
('77777777-7777-7777-7777-777777777777','shared_admin',true);
insert into private.admin_users(user_id) values ('77777777-7777-7777-7777-777777777777');

select is((select count(*)::int from public.categories where slug in ('ramen','beer','soju','snacks') and is_pickable and is_visible and status='open'),4,'four initial selectable categories');
select is((select count(*)::int from public.categories c join public.categories p on p.id=c.parent_id where c.slug in ('beer','soju') and p.slug='alcohol' and not p.is_pickable),2,'alcohol is only a grouping');
select ok(not has_function_privilege('anon','public.register_pick(uuid,uuid,text,text,text,text,text)','execute'),'anonymous pick registration denied');
select ok(not has_function_privilege('anon','public.submit_product(uuid,text,text,text,text)','execute'),'anonymous product submission denied');
select ok(not has_function_privilege('anon','public.current_user_is_admin()','execute'),'anonymous admin check denied');
select ok(not has_table_privilege('authenticated','private.admin_users','select'),'admin allowlist is not exposed');
select ok(not has_table_privilege('authenticated','private.image_import_limits','update'),'users cannot reset quota');
select is(private.canonical_product_name('진라면 매운맛 봉지면 120g 5봉','ramen'),'진라면 매운맛','bag and quantity ignored');
select is(private.canonical_product_name('진라면 매운맛 컵라면 110g','ramen'),'진라면 매운맛','cup ignored');
select is(private.canonical_product_name('컵누들 매콤한맛','ramen'),'컵누들 매콤한맛','product name preserved');

insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'product-photos','55555555-5555-5555-5555-555555555555/' || f.name,'55555555-5555-5555-5555-555555555555',
jsonb_build_object('mimetype','image/jpeg','size',f.size)
from (values ('full.jpg',1024),('thumb.jpg',100),('unused.jpg',100),('huge-thumb.jpg',100000)) f(name,size);

set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);

create temporary table shared_state as
select (public.submit_product(
  (select id from public.categories where slug='ramen'),
  '테스트라면 매운맛 봉지면 120g'
)).*;
grant select, update on table shared_state to authenticated;

select is((select status from shared_state),'pending','missing product is submitted as pending');
select is((select count(*)::int from public.picks where user_id=auth.uid()),0,'pending product does not create a pick');
select is((public.submit_product(
  (select category_id from shared_state),
  '테스트라면 매운맛 컵라면 110g'
)).id,(select id from shared_state),'canonical duplicate returns same pending product');
select is((select count(*)::int from public.products where normalized_name='테스트라면매운맛'),1,'pending duplicate is stored once');
select throws_ok(
  $$select public.register_pick((select category_id from shared_state),null,'테스트라면 매운맛','이유')$$,
  'P0001','PRODUCT_SELECTION_REQUIRED','pick registration requires an approved product id');
select throws_ok(
  $$select public.register_pick((select category_id from shared_state),(select id from shared_state),'테스트라면 매운맛','이유')$$,
  'P0001','PRODUCT_NOT_ELIGIBLE','pending product cannot be picked');
select throws_ok(
  $$insert into public.products(category_id,name,normalized_name,status,created_by)
    values ((select category_id from shared_state),'사용자직접활성','사용자직접활성','active',auth.uid())$$,
  '42501','new row violates row-level security policy for table "products"','ordinary user cannot insert active product');

create temporary table photo_state as
select (public.submit_product(
  (select category_id from shared_state),
  '사진요청라면',
  '55555555-5555-5555-5555-555555555555/full.jpg',
  '55555555-5555-5555-5555-555555555555/thumb.jpg',
  'https://www.otoki.com/product'
)).*;
grant select on table photo_state to authenticated;
select is((select status from photo_state),'pending','product with image is also pending');
select is((select image_path from photo_state),'55555555-5555-5555-5555-555555555555/full.jpg','submitted image is kept on pending product');
select ok(not private.is_unused_product_photo('55555555-5555-5555-5555-555555555555/full.jpg'),'pending product protects referenced image');
select throws_ok(
  $$select public.submit_product((select category_id from shared_state),'사진실패라면',
    '55555555-5555-5555-5555-555555555555/missing.jpg',
    '55555555-5555-5555-5555-555555555555/thumb.jpg')$$,
  'P0001','PHOTO_INVALID','missing storage object rejected');
select throws_ok(
  $$select public.submit_product((select category_id from shared_state),'큰사진라면',
    '55555555-5555-5555-5555-555555555555/unused.jpg',
    '55555555-5555-5555-5555-555555555555/huge-thumb.jpg')$$,
  'P0001','PHOTO_INVALID','thumbnail byte limit enforced');
select throws_ok(
  $$select public.submit_product((select id from public.categories where slug='alcohol'),'주류제품')$$,
  'P0001','CATEGORY_NOT_PICKABLE','parent cannot receive product submissions');

select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select is((select count(*)::int from public.products where id=(select id from shared_state)),0,'other users cannot read someone else pending product');
select is((public.submit_product(
  (select category_id from shared_state),
  '테스트라면 매운맛'
)).id,(select id from shared_state),'server dedupe still returns existing pending product to another submitter');

select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',true);
select ok(public.current_user_is_admin(),'admin allowlist grants admin access');
select is((select count(*)::int from public.products where status='pending' and id=(select id from shared_state)),1,'admin can read pending product');
select lives_ok(
  $$update public.products set status='active' where id=(select id from shared_state)$$,
  'admin can approve pending product');
select is((select status from public.products where id=(select id from shared_state)),'active','approved product becomes active');

select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
create temporary table pick_a as select (public.register_pick(
  (select category_id from shared_state),
  (select id from shared_state),
  '테스트라면 매운맛',
  '승인 후 첫 이유'
)).*;
grant select on table pick_a to authenticated;
select is((select product_id from pick_a),(select id from shared_state),'submitter can pick approved product');
select is((select one_line_review from pick_a),'승인 후 첫 이유','approved product stores review');

select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
create temporary table pick_b as select (public.register_pick(
  (select category_id from shared_state),
  (select id from shared_state),
  '테스트라면 매운맛',
  '다른 사람 이유'
)).*;
grant select on table pick_b to authenticated;
select is((select product_id from pick_b),(select id from shared_state),'another user shares the same approved product id');
select is((select count(*)::int from public.picks where product_id=(select id from shared_state) and status='active'),2,'approved product aggregates users on one product');

select lives_ok($$do $test$ begin for i in 1..10 loop perform public.consume_image_import(); end loop; end $test$;$$,'ten image imports per hour allowed');
select throws_ok($$select public.consume_image_import()$$,'P0001','RATE_LIMITED','eleventh import blocked');
reset role;
update private.image_import_limits set window_start=now()-interval '2 hours' where user_id='66666666-6666-6666-6666-666666666666';
set local role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select lives_ok($$select public.consume_image_import()$$,'quota resets after an hour');

select * from finish();
rollback;
