begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f7800000-0000-4000-8000-000000000001','authenticated','authenticated','dir-admin@example.invalid','',now(),now()),
  ('f7800000-0000-4000-8000-000000000002','authenticated','authenticated','dir-active@example.invalid','',now(),now()),
  ('f7800000-0000-4000-8000-000000000003','authenticated','authenticated','dir-suspended@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed,created_at,updated_at) values
  ('f7800000-0000-4000-8000-000000000001','dir_admin',true,now()-interval '3 days',now()-interval '3 days'),
  ('f7800000-0000-4000-8000-000000000002','dir_active',true,now()-interval '2 days',now()-interval '2 days'),
  ('f7800000-0000-4000-8000-000000000003','dir_suspended',true,now()-interval '1 day',now()-interval '1 day');
insert into private.admin_users(user_id) values('f7800000-0000-4000-8000-000000000001');
insert into private.user_moderation(user_id,reason,suspended_by)
values('f7800000-0000-4000-8000-000000000003','fixture','f7800000-0000-4000-8000-000000000001');

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('f7810000-0000-4000-8000-000000000001','Directory','directory-fixture','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status)
values('f7820000-0000-4000-8000-000000000001','f7810000-0000-4000-8000-000000000001','Directory item','directoryitem','active');
-- The active user has the newest activity even though they joined earlier.
insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,created_at)
values('f7830000-0000-4000-8000-000000000001','f7800000-0000-4000-8000-000000000002','f7810000-0000-4000-8000-000000000001','f7820000-0000-4000-8000-000000000001','fixture pick','active',now());
-- Community writes need an authenticated author (claim only, no role switch).
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f7800000-0000-4000-8000-000000000002','role','authenticated')::text, true);
insert into public.comments(pick_id,user_id,body)
values('f7830000-0000-4000-8000-000000000001','f7800000-0000-4000-8000-000000000002','fixture comment');
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f7800000-0000-4000-8000-000000000001','role','authenticated')::text, true);
-- One open report per reporter and target: resolve the first before filing the second.
insert into public.content_reports(id,reporter_user_id,target_type,target_id,target_user_id,reason) values
  ('f7840000-0000-4000-8000-000000000001','f7800000-0000-4000-8000-000000000001','profile','f7800000-0000-4000-8000-000000000002','f7800000-0000-4000-8000-000000000002','spam');
update public.content_reports set status='resolved', resolved_at=now()
where id='f7840000-0000-4000-8000-000000000001';
insert into public.content_reports(id,reporter_user_id,target_type,target_id,target_user_id,reason) values
  ('f7840000-0000-4000-8000-000000000002','f7800000-0000-4000-8000-000000000001','profile','f7800000-0000-4000-8000-000000000002','f7800000-0000-4000-8000-000000000002','spam');

create temp table dir_result(label text primary key, value jsonb);
grant all on dir_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f7800000-0000-4000-8000-000000000002','role','authenticated','aal','aal2')::text, true);

select throws_ok(
  $$select public.admin_user_directory()$$,
  '42501','ADMIN_REQUIRED',
  'non-admin cannot read the user directory'
);

select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f7800000-0000-4000-8000-000000000001','role','authenticated','aal','aal1')::text, true);

select throws_ok(
  $$select public.admin_user_directory()$$,
  '42501','ADMIN_REQUIRED',
  'admin without MFA cannot read the user directory'
);

select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f7800000-0000-4000-8000-000000000001','role','authenticated','aal','aal2')::text, true);

insert into dir_result values
  ('all', public.admin_user_directory('dir_', 'all', 'created', 50, 0)),
  ('suspended', public.admin_user_directory('dir_', 'suspended', 'created', 50, 0)),
  ('paged', public.admin_user_directory('dir_', 'all', 'created', 1, 1)),
  ('activity', public.admin_user_directory('dir_', 'all', 'activity', 50, 0)),
  ('by_id', public.admin_user_directory('F7800000-0000-4000-8000-000000000003', 'all', 'created', 50, 0)),
  ('wildcard', public.admin_user_directory('%', 'all', 'created', 50, 0));

select ok(
  ((select value from dir_result where label='suspended')->'counts'->>'suspended')::int >= 1
  and ((select value from dir_result where label='suspended')->'counts'->>'total')::int
    = (select count(*) from public.profiles),
  'summary counts cover every profile regardless of filter'
);

select is(
  (select jsonb_path_query_array(value, '$.users[*].username') from dir_result where label='suspended'),
  '["dir_suspended"]'::jsonb,
  'status filter is applied on the server'
);

select is(
  (select jsonb_path_query_array(value, '$.users[*].username') from dir_result where label='all'),
  '["dir_suspended","dir_active","dir_admin"]'::jsonb,
  'default order is newest sign-up first'
);

select is(
  (select value->>'matched' from dir_result where label='paged')::int, 3,
  'matched reports the filtered total, not the page size'
);
select is(
  (select jsonb_path_query_array(value, '$.users[*].username') from dir_result where label='paged'),
  '["dir_active"]'::jsonb,
  'limit and offset page through the filtered rows'
);

select is(
  (select value->'users'->0->>'username' from dir_result where label='activity'),
  'dir_active',
  'activity sort puts the most recently active user first'
);

select is(
  (select jsonb_build_object(
     'picks', u->'active_pick_count', 'comments', u->'comment_count',
     'reports', u->'report_count', 'open', u->'open_report_count')
   from dir_result, jsonb_array_elements(value->'users') u
   where label='all' and u->>'username'='dir_active'),
  '{"picks":1,"comments":1,"reports":2,"open":1}'::jsonb,
  'rows carry activity and report counts'
);

select is(
  (select jsonb_path_query_array(value, '$.users[*].username') from dir_result where label='by_id'),
  '["dir_suspended"]'::jsonb,
  'an exact user id (any case) finds that user'
);

select is(
  (select value->>'matched' from dir_result where label='wildcard')::int, 0,
  'LIKE wildcards in the query are matched literally'
);

select throws_ok(
  $$select public.admin_user_directory('', 'deleted')$$,
  '22023','INVALID_STATUS',
  'unknown status filter is rejected'
);

reset role;
select * from finish();
rollback;
