begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('77777777-7777-7777-7777-777777777777','authenticated','authenticated','admin-test@example.com','',now(),now()),
('88888888-8888-8888-8888-888888888888','authenticated','authenticated','member-test@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('77777777-7777-7777-7777-777777777777','admin_test',true),
('88888888-8888-8888-8888-888888888888','member_test',true);
insert into private.admin_users(user_id) values('77777777-7777-7777-7777-777777777777');
set local role authenticated;
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',true);
-- Real administrator data access now also requires AAL2; model a stepped-up session.
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select ok(public.current_user_is_admin(),'explicit admin membership accepted');
select lives_ok($$insert into public.categories(name,slug,status,is_visible,is_pickable) values('음식 테스트','qa-food','open',true,false)$$,'admin can create parent');
select lives_ok($$insert into public.categories(name,slug,parent_id,status,is_visible,is_pickable) values('새 분류','qa-new',(select id from public.categories where slug='qa-food'),'open',true,true)$$,'admin can create a new category beyond initial four');
select throws_ok($$update public.categories set is_pickable=true where slug='qa-food'$$,'P0001','CATEGORY_INVALID','parent with children cannot become pickable');
select throws_ok($$update public.categories set parent_id=id where slug='qa-new'$$,'P0001','CATEGORY_INVALID','self-parent rejected');
select throws_ok($$update public.categories set parent_id=(select id from public.categories where slug='qa-new') where slug='qa-food'$$,'P0001','CATEGORY_INVALID','cycle rejected');
select throws_ok($$insert into public.categories(name,slug,parent_id,status,is_visible,is_pickable) values('세 단계','qa-depth',(select id from public.categories where slug='qa-new'),'open',true,true)$$,'P0001','CATEGORY_INVALID','third level rejected');
select throws_ok($$update public.categories set slug='qa-renamed' where slug='qa-new'$$,'P0001','CATEGORY_INVALID','stable category identifiers protected');
select lives_ok($$update public.categories set name='새 카테고리',sort_order=40 where slug='qa-new'$$,'admin can rename and reorder');
select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',true);
select ok(not public.current_user_is_admin(),'ordinary user is not admin');
select throws_ok($$insert into public.categories(name,slug) values('금지','qa-denied')$$,'42501',null,'ordinary user cannot add category');
update public.categories set name='사용자 변조' where slug='qa-new';
select is((select name from public.categories where slug='qa-new'),'새 카테고리','ordinary user cannot edit category');
select throws_ok($$insert into private.admin_users(user_id) values(auth.uid())$$,'42501',null,'user cannot grant own admin role');
select throws_ok($$insert into public.items(category_id,name,normalized_name,status,created_by) values((select id from public.categories where slug='qa-new'),'우회','우회','pending',auth.uid())$$,'42501',null,'direct pending insert cannot bypass RPC validation');
create temporary table admin_test_request as select id,category_id from public.submit_item((select id from public.categories where slug='qa-new'),'새 제품 120g');
select is((select name from public.items where id=(select id from admin_test_request)),'새 제품 120g','new category keeps its own item identity');
update public.items set status='active' where id=(select id from admin_test_request);
select is((select status from public.items where id=(select id from admin_test_request)),'pending','submitter cannot approve own request');
select throws_ok($$select public.change_pick((select category_id from admin_test_request),(select id from admin_test_request),'이유')$$,'P0001','ITEM_NOT_ELIGIBLE','pending item cannot be chosen through legacy route');
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',true);
select lives_ok($$update public.items set status='active' where id=(select id from admin_test_request)$$,'admin approves pending request');
select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',true);
select lives_ok($$select public.register_pick((select category_id from admin_test_request),(select id from admin_test_request),'새 제품 120g','이유')$$,'approved item in new category is selectable');
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',true);
update public.categories set is_visible=false where slug='qa-food';
select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',true);
select throws_ok($$select public.submit_item((select category_id from admin_test_request),'숨은 분류 제품')$$,'P0001','CATEGORY_NOT_PICKABLE','hidden parent blocks new requests');
select throws_ok($$select public.change_pick((select category_id from admin_test_request),(select id from admin_test_request),'바꾼 이유')$$,'P0001','CATEGORY_NOT_PICKABLE','hidden parent blocks legacy picks');
select is((select one_line_review from public.picks where user_id=auth.uid() and status='active'),'이유','failed edit preserves original pick');
reset role;
set local role anon;
select ok(not has_function_privilege('anon','public.current_user_is_admin()','execute'),'anonymous admin lookup denied');
select ok(not has_function_privilege('anon','public.submit_item(uuid,text,text,text,text)','execute'),'anonymous submissions denied');
select is((select count(*)::int from public.categories where slug='qa-food'),0,'hidden parent is not publicly readable');
select * from finish();
rollback;
