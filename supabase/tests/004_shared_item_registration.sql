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
select is(private.canonical_item_name('진라면 매운맛 봉지면 120g 5봉','ramen'),'진라면 매운맛','bag and quantity ignored');
select is(private.canonical_item_name('진라면 매운맛 컵라면 110g','ramen'),'진라면 매운맛','cup ignored');
select is(private.canonical_item_name('컵누들 매콤한맛','ramen'),'컵누들 매콤한맛','item name preserved');
select is(private.canonical_item_name('카스 0.0 330ml 병','beer'),'카스 0.0','nonalcoholic type preserved');
select is(private.canonical_item_name('새우깡 미니 90g','snacks'),'새우깡 미니','snack type preserved');

insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'item-photos','55555555-5555-5555-5555-555555555555/' || f.name,'55555555-5555-5555-5555-555555555555',
jsonb_build_object('mimetype','image/jpeg','size',f.size)
from (values ('full.jpg',1024),('thumb.jpg',100),('unused.jpg',100),('large-full.jpg',2097152),('large-thumb.jpg',204800)) f(name,size);

set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
create temporary table shared_state as select id as item_id,category_id from public.submit_item(
  (select id from public.categories where slug='ramen'),'테스트라면 매운맛 봉지면 120g');
select is((select status from public.items where id=(select item_id from shared_state)),'pending','missing item awaits approval');
select ok((select image_path is null from public.items where id=(select item_id from shared_state)),'photo is optional');
select is((public.submit_item((select category_id from shared_state),'테스트라면 매운맛 컵라면 110g')).id,
  (select item_id from shared_state),'own repeated request uses same normalized item');
select is((select count(*)::int from public.picks where user_id=auth.uid()),0,'request does not create a pick');
select throws_ok($$select public.register_pick((select category_id from shared_state),(select item_id from shared_state),'이름','이유')$$,
  'P0001','ITEM_NOT_ELIGIBLE','pending items cannot be picked');
select throws_ok($$select public.register_pick((select category_id from shared_state),null,'이름','이유')$$,
  'P0001','ITEM_SELECTION_REQUIRED','register_pick cannot bypass approval');
select throws_ok($$select public.submit_item((select category_id from shared_state),'사진실패라면',
  '55555555-5555-5555-5555-555555555555/missing.jpg','55555555-5555-5555-5555-555555555555/thumb.jpg')$$,
  'P0001','PHOTO_INVALID','missing object rejected');
select lives_ok($test$select public.submit_item((select category_id from shared_state),'큰사진라면',
  '55555555-5555-5555-5555-555555555555/large-full.jpg','55555555-5555-5555-5555-555555555555/large-thumb.jpg')$test$,
  'large JPEG metadata is accepted without the old byte-size cap');
select throws_ok($$select public.submit_item((select id from public.categories where slug='alcohol'),'주류제품')$$,
  'P0001','CATEGORY_NOT_PICKABLE','parent cannot receive requests');
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select is((select count(*)::int from public.items where id=(select item_id from shared_state)),0,'another user cannot read pending request');
select throws_ok(
  $sql$select public.submit_item((select category_id from shared_state),'테스트라면 매운맛 컵라면')$sql$,
  'P0001','ITEM_ALREADY_PENDING',
  'another user cannot create a duplicate pending request'
);
select throws_ok($$select public.submit_item((select category_id from shared_state),'도용라면',
  '55555555-5555-5555-5555-555555555555/unused.jpg','55555555-5555-5555-5555-555555555555/thumb.jpg')$$,
  'P0001','PHOTO_INVALID','cannot attach another user upload');

reset role;
update public.items set status='active' where id=(select item_id from shared_state);
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
select lives_ok($$select public.register_pick((select category_id from shared_state),(select item_id from shared_state),'테스트라면','사진 추가',
  '55555555-5555-5555-5555-555555555555/full.jpg','55555555-5555-5555-5555-555555555555/thumb.jpg','https://www.otoki.com/item')$$,'approved item can be picked with first shared image');
select ok(not private.is_unused_item_photo('55555555-5555-5555-5555-555555555555/full.jpg'),'referenced full image protected');
select ok(not private.is_unused_item_photo('55555555-5555-5555-5555-555555555555/thumb.jpg'),'referenced thumbnail protected');
select ok(private.is_unused_item_photo('55555555-5555-5555-5555-555555555555/unused.jpg'),'owner can clean unused file');
select lives_ok($$select public.register_pick((select category_id from shared_state),(select item_id from shared_state),'테스트라면','두 번째 이유')$$,'same approved pick can be edited');
select is((select one_line_review from public.picks where user_id=auth.uid() and status='active'),'두 번째 이유','review updated');
select is((select count(*)::int from public.picks where user_id=auth.uid() and status='active'),1,'one current pick after repeated selection');
select throws_ok($$select public.register_pick((select category_id from shared_state),(select item_id from shared_state),'이름',' ')$$,
  'P0001','REVIEW_INVALID','blank review rejected');
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select is((public.submit_item((select category_id from shared_state),'테스트라면 매운맛 큰사발')).id,
  (select item_id from shared_state),'formal item takes precedence over pending duplicates');
select lives_ok($$select public.register_pick((select category_id from shared_state),(select item_id from shared_state),'테스트라면','다른 사람 이유',
  '66666666-6666-6666-6666-666666666666/new.jpg','66666666-6666-6666-6666-666666666666/thumb.jpg')$$,'existing shared image is reused');
select is((select image_path from public.items where id=(select item_id from shared_state)),
  '55555555-5555-5555-5555-555555555555/full.jpg','shared image unchanged');
select ok(not private.is_unused_item_photo('55555555-5555-5555-5555-555555555555/unused.jpg'),'cannot clean another user file');
select lives_ok($$do $test$ begin for i in 1..10 loop perform public.consume_image_import(); end loop; end $test$;$$,'ten image imports per hour allowed');
select throws_ok($$select public.consume_image_import()$$,'P0001','RATE_LIMITED','eleventh import blocked');
reset role;
update private.image_import_limits set window_start=now()-interval '2 hours' where user_id='66666666-6666-6666-6666-666666666666';
update public.items set status='hidden' where id=(select item_id from shared_state);
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
select ok(not private.is_unused_item_photo('55555555-5555-5555-5555-555555555555/full.jpg'),'hidden shared item still protects image');
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select lives_ok($$select public.consume_image_import()$$,'quota resets after an hour');
select * from finish();
rollback;

