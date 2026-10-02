begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

do $flow$
declare
  target uuid := 'fa450000-0000-4000-8000-000000000001';
  viewer uuid := 'fa450000-0000-4000-8000-000000000002';
  alice uuid := 'fa450000-0000-4000-8000-000000000003';
  bob uuid := 'fa450000-0000-4000-8000-000000000004';
  carol uuid := 'fa450000-0000-4000-8000-000000000005';
  suspended_user uuid := 'fa450000-0000-4000-8000-000000000006';
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (target,'authenticated','authenticated',now(),now()),
    (viewer,'authenticated','authenticated',now(),now()),
    (alice,'authenticated','authenticated',now(),now()),
    (bob,'authenticated','authenticated',now(),now()),
    (carol,'authenticated','authenticated',now(),now()),
    (suspended_user,'authenticated','authenticated',now(),now());

  insert into public.profiles(id,username,bio,onboarding_completed) values
    (target,'target_user','target bio',true),
    (viewer,'viewer_user','viewer bio',true),
    (alice,'alice_user','alice bio',true),
    (bob,'bob_user','bob bio',true),
    (carol,'carol_user','carol bio',true),
    (suspended_user,'suspended_user','suspended bio',true);

  -- Viewer follows target plus two people so row-level viewer_is_following can be tested.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values
    (viewer,target),(viewer,alice),(viewer,carol);
  reset role;

  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(alice,target);
  reset role;

  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(bob,target);
  reset role;

  perform set_config('request.jwt.claim.sub',suspended_user::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(suspended_user,target);
  reset role;

  perform set_config('request.jwt.claim.sub',target::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values
    (target,carol),(target,bob);
  reset role;

  -- Suspension does not delete the old row; public reads must filter it.
  perform set_config('request.jwt.claim.sub','',true);
  insert into private.user_moderation(user_id,reason)
  values(suspended_user,'public follow connection test');

  -- Viewer blocks Bob. Bob's relationship with target still exists, but must be hidden from this viewer.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
  values(viewer,bob,'bob_user');
  reset role;
end;
$flow$;

select ok(
  has_function_privilege('anon','public.profile_follow_counts(uuid)','execute'),
  'anon can read sanitized public follow counts'
);
select ok(
  has_function_privilege('authenticated','public.profile_follow_counts(uuid)','execute'),
  'authenticated can read sanitized public follow counts'
);
select ok(
  has_function_privilege('anon','public.profile_follow_connections_page(uuid,text,text,uuid,integer)','execute'),
  'anon can read sanitized public follow connections'
);
select ok(
  not has_table_privilege('anon','public.user_follows','select'),
  'anon still cannot read user_follows directly'
);
select ok(
  (select prosecdef from pg_proc where oid='public.profile_follow_counts(uuid)'::regprocedure),
  'public count RPC is security definer so it can read private follow rows without opening table RLS'
);
select ok(
  (select prosecdef from pg_proc where oid='public.profile_follow_connections_page(uuid,text,text,uuid,integer)'::regprocedure),
  'public connections RPC is security definer'
);

-- Anonymous viewers see every non-suspended connection because they have no personal block graph.
select set_config('request.jwt.claim.sub','',true);
set local role anon;

select is(
  (select follower_count from public.profile_follow_counts('fa450000-0000-4000-8000-000000000001')),
  3::bigint,
  'anon follower count excludes suspended account'
);
select is(
  (select following_count from public.profile_follow_counts('fa450000-0000-4000-8000-000000000001')),
  2::bigint,
  'anon following count includes both visible followees'
);
select is(
  (select array_agg(username order by username)
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001','followers'
   )),
  array['alice_user','bob_user','viewer_user']::text[],
  'anon followers list exposes only public profile fields and excludes suspended account'
);
reset role;

-- Authenticated viewer-specific block filtering must keep counts and list in sync.
select set_config('request.jwt.claim.sub','fa450000-0000-4000-8000-000000000002',true);
set local role authenticated;

select is(
  (select follower_count from public.profile_follow_counts('fa450000-0000-4000-8000-000000000001')),
  2::bigint,
  'viewer follower count excludes blocked and suspended accounts'
);
select is(
  (select following_count from public.profile_follow_counts('fa450000-0000-4000-8000-000000000001')),
  1::bigint,
  'viewer following count excludes blocked account'
);
select is(
  (select array_agg(username order by username)
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001','followers'
   )),
  array['alice_user','viewer_user']::text[],
  'viewer followers page matches the filtered count'
);
select is(
  (select viewer_is_following
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001','followers'
   )
   where username='alice_user'),
  true,
  'viewer_is_following is true for a followed connected user'
);
select is(
  (select viewer_is_following
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001','followers'
   )
   where username='viewer_user'),
  false,
  'viewer_is_following is false for the viewer self row'
);
select is(
  (select array_agg(username order by username)
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001','following'
   )),
  array['carol_user']::text[],
  'following page applies the same block and suspension visibility rules'
);

-- p_limit rows + one lookahead. The last displayed row is the next cursor.
select is(
  (select count(*)
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001','followers',null,null,1
   )),
  2::bigint,
  'connections page returns one lookahead row'
);
select is(
  (select array_agg(username order by username)
   from public.profile_follow_connections_page(
     'fa450000-0000-4000-8000-000000000001',
     'followers',
     'alice_user',
     'fa450000-0000-4000-8000-000000000003',
     1
   )),
  array['viewer_user']::text[],
  'username + user id cursor continues without overlap'
);

select throws_ok(
  $$select * from public.profile_follow_connections_page(
    'fa450000-0000-4000-8000-000000000001','invalid'
  )$$,
  '22023','INVALID_DIRECTION',
  'invalid direction is rejected'
);
select throws_ok(
  $$select * from public.profile_follow_connections_page(
    'fa450000-0000-4000-8000-000000000001','followers','alice_user',null,20
  )$$,
  '22023','INVALID_PAGINATION_CURSOR',
  'half cursor is rejected'
);
select throws_ok(
  $$select * from public.profile_follow_connections_page(
    'fa450000-0000-4000-8000-000000000001','followers',null,null,51
  )$$,
  '22023','INVALID_PAGE_SIZE',
  'oversized page is rejected'
);

-- Direct table read is still own-rows only for authenticated users.
select is(
  (select count(*) from public.user_follows),
  3::bigint,
  'authenticated viewer can still read only their own follow rows'
);

-- Blocking the target hides the target's counts and connections entirely.
insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
values(
  'fa450000-0000-4000-8000-000000000002',
  'fa450000-0000-4000-8000-000000000001',
  'target_user'
);
select is(
  (select count(*) from public.profile_follow_counts('fa450000-0000-4000-8000-000000000001')),
  0::bigint,
  'blocked target returns no public count row'
);
select is(
  (select count(*) from public.profile_follow_connections_page(
    'fa450000-0000-4000-8000-000000000001','followers'
  )),
  0::bigint,
  'blocked target returns no public connections'
);
reset role;

-- Suspended target is also indistinguishable from an unavailable public profile.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is(
  (select count(*) from public.profile_follow_counts('fa450000-0000-4000-8000-000000000006')),
  0::bigint,
  'suspended target returns no public count row'
);
select is(
  (select count(*) from public.profile_follow_connections_page(
    'fa450000-0000-4000-8000-000000000006','followers'
  )),
  0::bigint,
  'suspended target returns no public connections'
);
reset role;

select * from finish();
rollback;
