begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('a1111111-1111-1111-1111-111111111111','authenticated','authenticated','safety-a@example.com','',now(),now()),
('b2222222-2222-2222-2222-222222222222','authenticated','authenticated','safety-b@example.com','',now(),now()),
('c3333333-3333-3333-3333-333333333333','authenticated','authenticated','safety-admin@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('a1111111-1111-1111-1111-111111111111','safety_a',true),
('b2222222-2222-2222-2222-222222222222','safety_b',true),
('c3333333-3333-3333-3333-333333333333','safety_admin',true);
insert into private.admin_users(user_id) values('c3333333-3333-3333-3333-333333333333');
insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order) values
('d4444444-4444-4444-4444-444444444444','Safety Test','safety-test','open',true,true,9999);
insert into public.products(id,category_id,name,normalized_name,status,created_by) values
('e5555555-5555-5555-5555-555555555555','d4444444-4444-4444-4444-444444444444','Safety Product','safetyproduct','active','b2222222-2222-2222-2222-222222222222');
insert into public.picks(id,user_id,category_id,product_id,one_line_review,status) values
('f6666666-6666-6666-6666-666666666666','b2222222-2222-2222-2222-222222222222','d4444444-4444-4444-4444-444444444444','e5555555-5555-5555-5555-555555555555','B pick','active');
insert into public.comments(id,pick_id,user_id,body) values
('f7777777-7777-7777-7777-777777777777','f6666666-6666-6666-6666-666666666666','a1111111-1111-1111-1111-111111111111','A comment');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',true);

select lives_ok($$insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
values('a1111111-1111-1111-1111-111111111111','b2222222-2222-2222-2222-222222222222','ignored')$$,'user can block another profile');
select is((select blocked_username_snapshot from public.user_blocks where blocker_user_id='a1111111-1111-1111-1111-111111111111' and blocked_user_id='b2222222-2222-2222-2222-222222222222'),'safety_b','block stores username snapshot');
select is((select count(*)::int from public.profiles where id='b2222222-2222-2222-2222-222222222222'),0,'block hides target profile');
select is((select count(*)::int from public.picks where id='f6666666-6666-6666-6666-666666666666'),0,'block hides target Pick');
select is((select count(*)::int from public.comments where pick_id='f6666666-6666-6666-6666-666666666666'),0,'block hides comments on target Pick');
select throws_ok($$insert into public.comments(pick_id,user_id,body) values('f6666666-6666-6666-6666-666666666666','a1111111-1111-1111-1111-111111111111','blocked comment')$$,'42501',null,'blocked user cannot comment on target Pick');

select lives_ok($$insert into public.content_reports(reporter_user_id,target_type,target_id,reason,details)
values('a1111111-1111-1111-1111-111111111111','profile','b2222222-2222-2222-2222-222222222222','spam','  test report  ')$$,'user can report another profile');
select is((select target_user_id from public.content_reports where reporter_user_id='a1111111-1111-1111-1111-111111111111'),'b2222222-2222-2222-2222-222222222222'::uuid,'report target owner is derived by database');
select is((select details from public.content_reports where reporter_user_id='a1111111-1111-1111-1111-111111111111'),'test report','report details are trimmed');
select throws_ok($$insert into public.content_reports(reporter_user_id,target_type,target_id,reason)
values('a1111111-1111-1111-1111-111111111111','profile','b2222222-2222-2222-2222-222222222222','spam')$$,'23505',null,'duplicate active report is rejected');
select throws_ok($$insert into public.content_reports(reporter_user_id,target_type,target_id,reason)
values('a1111111-1111-1111-1111-111111111111','profile','a1111111-1111-1111-1111-111111111111','spam')$$,'P0001','REPORT_SELF','self report is rejected');
update public.content_reports set status='resolved' where reporter_user_id='a1111111-1111-1111-1111-111111111111';
select is((select status from public.content_reports where reporter_user_id='a1111111-1111-1111-1111-111111111111'),'open','ordinary user cannot resolve reports');

select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',true);
select is((select count(*)::int from public.profiles where id='a1111111-1111-1111-1111-111111111111'),0,'block hides blocker profile in reverse direction');

select set_config('request.jwt.claim.sub','c3333333-3333-3333-3333-333333333333',true);
select lives_ok($$update public.content_reports set status='resolved' where reporter_user_id='a1111111-1111-1111-1111-111111111111'$$,'admin can resolve reports');
select ok((select resolved_by='c3333333-3333-3333-3333-333333333333'::uuid and resolved_at is not null from public.content_reports where reporter_user_id='a1111111-1111-1111-1111-111111111111'),'resolution records admin and timestamp');

reset role;
delete from auth.users where id='b2222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.profiles where id='b2222222-2222-2222-2222-222222222222'),0,'deleting auth user cascades profile');
select is((select count(*)::int from public.picks where user_id='b2222222-2222-2222-2222-222222222222'),0,'deleting auth user cascades Picks');
select is((select count(*)::int from public.user_blocks where blocked_user_id='b2222222-2222-2222-2222-222222222222'),0,'deleting auth user cascades blocks');
select is((select created_by from public.products where id='e5555555-5555-5555-5555-555555555555'),null::uuid,'approved product remains with creator cleared');
select is((select target_user_id from public.content_reports where reporter_user_id='a1111111-1111-1111-1111-111111111111'),null::uuid,'report history remains with deleted target cleared');

select * from finish();
rollback;
