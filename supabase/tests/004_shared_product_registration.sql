begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('55555555-5555-5555-5555-555555555555','authenticated','authenticated','shared-a@example.com','',now(),now()),
('66666666-6666-6666-6666-666666666666','authenticated','authenticated','shared-b@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('55555555-5555-5555-5555-555555555555','shared_a',true),
('66666666-6666-6666-6666-666666666666','shared_b',true);

select is((select count(*)::int from public.categories where slug in ('ramen','beer','soju','snacks') and is_pickable and is_visible and status='open'),4,'four initial selectable categories');
select is((select count(*)::int from public.categories c join public.categories p on p.id=c.parent_id where c.slug in ('beer','soju') and p.slug='alcohol' and not p.is_pickable),2,'alcohol is only a grouping');
select ok(not has_function_privilege('anon','public.register_pick(uuid,uuid,text,text,text,text,text)','execute'),'anonymous registration denied');
select ok(not has_function_privilege('anon','public.consume_image_import()','execute'),'anonymous image importing denied');
select ok(not has_table_privilege('authenticated','private.image_import_limits','update'),'users cannot reset quota');
select is(private.canonical_product_name('진라면 매운맛 봉지면 120g 5봉','ramen'),'진라면 매운맛','bag and quantity ignored');
select is(private.canonical_product_name('진라면 매운맛 컵라면 110g','ramen'),'진라면 매운맛','cup ignored');
select is(private.canonical_product_name('컵누들 매콤한맛','ramen'),'컵누들 매콤한맛','product name preserved');
select is(private.canonical_product_name('카스 0.0 330ml 병','beer'),'카스 0.0','nonalcoholic type preserved');
select is(private.canonical_product_name('새우깡 미니 90g','snacks'),'새우깡 미니','snack type preserved');

insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'product-photos','55555555-5555-5555-5555-555555555555/' || f.name,'55555555-5555-5555-5555-555555555555',
jsonb_build_object('mimetype','image/jpeg','size',f.size)
from (values ('full.jpg',1024),('thumb.jpg',100),('unused.jpg',100),('huge-thumb.jpg',100000)) f(name,size);

set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
create temporary table shared_state as select (public.register_pick(
(select id from public.categories where slug='ramen'),null,'테스트라면 매운맛 봉지면 120g','처음 이유')).*;
select is((select count(*)::int from public.products where normalized_name='테스트라면매운맛'),1,'photo-free product created once');
select ok((select image_path is null from public.products where id=(select product_id from shared_state)),'photo is optional');
select is((public.register_pick((select category_id from shared_state),null,'테스트라면 매운맛 컵라면 110g','두 번째 이유')).id,
(select id from shared_state),'cup resolves to same product and pick');
select is((select one_line_review from public.picks where id=(select id from shared_state)),'두 번째 이유','same pick review is updated');
select lives_ok($$select public.register_pick((select category_id from shared_state),null,'테스트라면 매운맛','사진 추가',
'55555555-5555-5555-5555-555555555555/full.jpg','55555555-5555-5555-5555-555555555555/thumb.jpg','https://www.otoki.com/product')$$,'first shared image attached');
select ok(not private.is_unused_product_photo('55555555-5555-5555-5555-555555555555/full.jpg'),'referenced full image protected');
select ok(not private.is_unused_product_photo('55555555-5555-5555-5555-555555555555/thumb.jpg'),'referenced thumbnail protected');
select ok(private.is_unused_product_photo('55555555-5555-5555-5555-555555555555/unused.jpg'),'owner can clean unused file');
select throws_ok($$select public.register_pick((select category_id from shared_state),null,'사진실패라면','이유',
'55555555-5555-5555-5555-555555555555/missing.jpg','55555555-5555-5555-5555-555555555555/thumb.jpg')$$,
'P0001','PHOTO_INVALID','missing storage object rejected');
select is((select count(*)::int from public.products where name='사진실패라면'),0,'failed photo registration rolls back new product');
select throws_ok($$select public.register_pick((select category_id from shared_state),null,'큰사진라면','이유',
'55555555-5555-5555-5555-555555555555/unused.jpg','55555555-5555-5555-5555-555555555555/huge-thumb.jpg')$$,
'P0001','PHOTO_INVALID','thumbnail byte limit enforced');
select throws_ok($$select public.register_pick((select id from public.categories where slug='alcohol'),null,'주류제품','이유')$$,
'P0001','CATEGORY_NOT_PICKABLE','parent cannot be picked');
select throws_ok($$select public.register_pick((select category_id from shared_state),null,'이름','  ')$$,
'P0001','REVIEW_INVALID','blank review rejected');

select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select is((public.register_pick((select category_id from shared_state),null,'테스트라면 매운맛 큰사발','다른 사람 이유')).product_id,
(select product_id from shared_state),'another user shares same product');
select is((select image_path from public.products where id=(select product_id from shared_state)),
'55555555-5555-5555-5555-555555555555/full.jpg','another user reuses original image');
select lives_ok($$select public.register_pick((select category_id from shared_state),null,'테스트라면 매운맛','교체 시도',
'66666666-6666-6666-6666-666666666666/new.jpg','66666666-6666-6666-6666-666666666666/thumb.jpg')$$,'existing image ignores replacement during picking');
select is((select image_path from public.products where id=(select product_id from shared_state)),
'55555555-5555-5555-5555-555555555555/full.jpg','shared image unchanged');
select ok(not private.is_unused_product_photo('55555555-5555-5555-5555-555555555555/unused.jpg'),'cannot clean another user file');
select throws_ok($$select public.register_pick((select category_id from shared_state),null,'도용라면','이유',
'55555555-5555-5555-5555-555555555555/unused.jpg','55555555-5555-5555-5555-555555555555/thumb.jpg')$$,
'P0001','PHOTO_INVALID','cannot attach another user upload');
select isnt((public.register_pick((select category_id from shared_state),null,'테스트라면 순한맛','순한맛 이유')).product_id,
(select product_id from shared_state),'different taste is a different product');
select is((select count(*)::int from public.picks where user_id=auth.uid() and status='active'),1,'replacement leaves one current pick');
select is((select count(*)::int from public.picks where user_id=auth.uid() and status='replaced'),1,'previous product kept in history');

select lives_ok($$do $test$ begin for i in 1..10 loop perform public.consume_image_import(); end loop; end $test$;$$,'ten image imports per hour allowed');
select throws_ok($$select public.consume_image_import()$$,'P0001','RATE_LIMITED','eleventh import blocked');
reset role;
update private.image_import_limits set window_start=now()-interval '2 hours' where user_id='66666666-6666-6666-6666-666666666666';
update public.products set status='hidden' where id=(select product_id from shared_state);
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
select ok(not private.is_unused_product_photo('55555555-5555-5555-5555-555555555555/full.jpg'),'hidden shared product still protects image');
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select lives_ok($$select public.consume_image_import()$$,'quota resets after an hour');
select * from finish();
rollback;
