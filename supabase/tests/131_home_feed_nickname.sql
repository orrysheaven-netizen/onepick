begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,created_at,updated_at) values
  ('fa310000-0000-4000-8000-000000000001','authenticated','authenticated',now(),now()),
  ('fa310000-0000-4000-8000-000000000002','authenticated','authenticated',now(),now()),
  ('fa310000-0000-4000-8000-000000000003','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,nickname,onboarding_completed) values
  ('fa310000-0000-4000-8000-000000000001','feednick_a','오리',true),
  ('fa310000-0000-4000-8000-000000000002','feednick_b',null,true),
  ('fa310000-0000-4000-8000-000000000003','feednick_viewer',null,true);
insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('fa311000-0000-4000-8000-000000000001','Nickname feed','nickname-feed','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status) values
  ('fa312000-0000-4000-8000-000000000001','fa311000-0000-4000-8000-000000000001','Nick item','nickitem','active');
insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
  ('fa313000-0000-4000-8000-000000000001','fa310000-0000-4000-8000-000000000001','fa311000-0000-4000-8000-000000000001','fa312000-0000-4000-8000-000000000001','A','active',now()+interval '2 day'),
  ('fa313000-0000-4000-8000-000000000002','fa310000-0000-4000-8000-000000000002','fa311000-0000-4000-8000-000000000001','fa312000-0000-4000-8000-000000000001','B','active',now()+interval '2 day' - interval '1 second');

select has_function('public','home_pick_feed_page',array['timestamp with time zone','uuid','text','text','uuid'],
  'signature is unchanged');
select is(
  (select prosecdef from pg_proc where oid='public.home_pick_feed_page(timestamptz,uuid,text,text,uuid)'::regprocedure),
  false, 'still SECURITY INVOKER (caller RLS decides visibility)');
select ok(has_function_privilege('anon','public.home_pick_feed_page(timestamptz,uuid,text,text,uuid)','execute'), 'anon can read the public feed');
select ok(not has_function_privilege('public','public.home_pick_feed_page(timestamptz,uuid,text,text,uuid)','execute'), 'PUBLIC grant stays revoked');

set local role anon;
select is((select nickname from public.home_pick_feed_page(null,null,null,null,'fa311000-0000-4000-8000-000000000001') where user_id='fa310000-0000-4000-8000-000000000001'),
  '오리', 'a set nickname reaches the card');
select is((select nickname from public.home_pick_feed_page(null,null,null,null,'fa311000-0000-4000-8000-000000000001') where user_id='fa310000-0000-4000-8000-000000000002'),
  null::text, 'an unset nickname stays NULL (the app shows the username)');
select is((select username from public.home_pick_feed_page(null,null,null,null,'fa311000-0000-4000-8000-000000000001') where user_id='fa310000-0000-4000-8000-000000000001'),
  'feednick_a', 'username is still returned for profile routes');
select is((select array_agg(pick_id order by started_at desc, pick_id desc) from public.home_pick_feed_page(null,null,null,null,'fa311000-0000-4000-8000-000000000001')),
  array['fa313000-0000-4000-8000-000000000001','fa313000-0000-4000-8000-000000000002']::uuid[], 'newest-first order unchanged');
reset role;

-- The viewer's own Picks stay out of their own feed.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa310000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','fa310000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.home_pick_feed_page(null,null,null,null,'fa311000-0000-4000-8000-000000000001') where user_id='fa310000-0000-4000-8000-000000000001'),
  0, 'self exclusion unchanged');
reset role;

select * from finish();
rollback;
