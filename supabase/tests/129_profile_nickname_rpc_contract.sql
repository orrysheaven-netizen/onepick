begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
set local plpgsql.check_asserts = on;

-- 1. The projection helper is internal: app roles never call it directly.
select ok(
  not has_function_privilege('anon', 'private.public_profile_json(public.profiles)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.public_profile_json(public.profiles)', 'EXECUTE'),
  'Private projection helper cannot be called directly by app roles'
);

-- 2. Field contract of the helper itself (run as the test superuser).
--    Exactly the seven pre-existing profile columns plus nickname; nothing else.
select is(
  (
    select array_agg(k order by k)
    from jsonb_object_keys(private.public_profile_json(
      jsonb_populate_record(null::public.profiles, '{"username":"contract_probe"}'::jsonb)
    )) k
  ),
  array['bio','created_at','id','nickname','onboarding_completed',
        'profile_image_url','updated_at','username'],
  'public_profile_json returns exactly the approved public field set'
);

-- 3. RPC behaviour: nicknames flow through the explicit projection, and the
--    existing suspended / blocked / deleted protections are not loosened.
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid();        -- blocks blocked_u
  viewer_rev uuid := gen_random_uuid();    -- is blocked BY blocked_u (reverse block)
  owner_u uuid := gen_random_uuid();
  writer_u uuid := gen_random_uuid();
  blocked_u uuid := gen_random_uuid();
  suspended_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid();
  menu uuid := gen_random_uuid();
  item_x uuid := gen_random_uuid();
  owner_pick uuid := gen_random_uuid();
  writer_pick uuid := gen_random_uuid();
  blocked_pick uuid := gen_random_uuid();
  suspended_pick uuid := gen_random_uuid();
  writer_comment uuid := gen_random_uuid();
  writer_comment_gone uuid := gen_random_uuid();
  owner_reply uuid := gen_random_uuid();      -- keeps writer_comment_gone as a tombstone
  blocked_comment uuid := gen_random_uuid();
  blocked_reply uuid := gen_random_uuid();
  suspended_comment uuid := gen_random_uuid();
  suspended_reply uuid := gen_random_uuid();
  row_json jsonb;
  profile_json jsonb;
  all_text text;
  expected_keys text[] := array[
    'bio','created_at','id','nickname','onboarding_completed',
    'profile_image_url','updated_at','username'
  ];
  got text[];
begin
  ------------------------------------------------------------------ fixture
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now()
    from unnest(array[viewer,viewer_rev,owner_u,writer_u,blocked_u,suspended_u]) id;
  insert into public.profiles(id,username,nickname,onboarding_completed)
    select id, 'nickrpc_' || substr(replace(id::text,'-',''),1,12),
      case when id=owner_u then '가게주인'
           when id=writer_u then '댓글주인'
           when id=blocked_u then '차단된사람'
           when id=suspended_u then '비공개사람'
           else null end, true
    from unnest(array[viewer,viewer_rev,owner_u,writer_u,blocked_u,suspended_u]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'NICK RPC 그룹', 'nickrpc-group', 'open', true, false, 910
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu,food_group,'NICK RPC 국','nickrpc-soup','open',true,true,910);
  insert into public.items(id,category_id,name,normalized_name,status)
    values(item_x,menu,'NICK RPC 국집','nickrpc-item','active');
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values
      (owner_pick,owner_u,menu,item_x,'online','review owner','active',now()-interval '2 days'),
      (writer_pick,writer_u,menu,item_x,'online','review writer','active',now()-interval '1 day'),
      (blocked_pick,blocked_u,menu,item_x,'online','review blocked','active',now()-interval '1 day'),
      (suspended_pick,suspended_u,menu,item_x,'online','review suspended','active',now()-interval '1 day');

  -- Comments are written by their authors through the normal authenticated path,
  -- before any suspension/block exists, so the fixture respects existing RLS.
  perform set_config('request.jwt.claim.sub',writer_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body)
    values(writer_comment,owner_pick,writer_u,'writer comment'),
          (writer_comment_gone,owner_pick,writer_u,'writer comment to delete');
  reset role;

  -- The review owner replies, so deleting writer_comment_gone later leaves a
  -- tombstone (a comment with no live replies is removed outright instead).
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,parent_comment_id,user_id,body)
    values(owner_reply,owner_pick,writer_comment_gone,owner_u,'owner reply');
  reset role;

  perform set_config('request.jwt.claim.sub',blocked_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body)
    values(blocked_comment,owner_pick,blocked_u,'blocked top-level');
  insert into public.comments(id,pick_id,parent_comment_id,user_id,body)
    values(blocked_reply,owner_pick,writer_comment,blocked_u,'blocked reply');
  -- reverse block: blocked_u blocks viewer_rev (blocker must be the JWT user)
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select blocked_u, viewer_rev, username from public.profiles where id=viewer_rev;
  reset role;

  perform set_config('request.jwt.claim.sub',suspended_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body)
    values(suspended_comment,owner_pick,suspended_u,'suspended top-level');
  insert into public.comments(id,pick_id,parent_comment_id,user_id,body)
    values(suspended_reply,owner_pick,writer_comment,suspended_u,'suspended reply');
  reset role;

  insert into private.user_moderation(user_id,reason,suspended_at)
    values(suspended_u,'nickname RPC fixture',now());

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select viewer, blocked_u, username from public.profiles where id=blocked_u;
  reset role;

  ------------------------------------------------- anon: review page contract
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;

  select r into row_json from public.item_review_page(item_x) r
    where r->>'id'=owner_pick::text;
  profile_json := row_json->'profile';
  select array_agg(k order by k) into got from jsonb_object_keys(profile_json) k;
  assert got=expected_keys, 'Review profile must have exact approved keys: '||got::text;
  assert profile_json->>'nickname'='가게주인'
    and profile_json->>'username' like 'nickrpc_%',
    'Review returns explicit nickname while keeping identity';
  assert not (profile_json ?| array['raw_user_meta_data','email','is_admin']),
    'Review profile exposes no unrelated account data';

  -- Suspended author: review hidden, and the nickname appears nowhere in the response.
  assert not exists(
    select 1 from public.item_review_page(item_x) r
    where r->>'id'=suspended_pick::text
  ), 'Suspended review stays hidden from anon';
  select coalesce(jsonb_agg(r)::text,'') into all_text from public.item_review_page(item_x) r;
  assert position('비공개사람' in all_text)=0,
    'Suspended nickname never appears in anon item_review_page output';
  -- A block between two members does not affect anon.
  assert exists(
    select 1 from public.item_review_page(item_x) r
    where r->>'id'=blocked_pick::text and r->'profile'->>'nickname'='차단된사람'
  ), 'A member block is private to the two members; anon still sees the review';

  ------------------------------------------------ anon: comment page contract
  select r into row_json from public.pick_comment_page(owner_pick) r
    where r->>'id'=writer_comment::text;
  profile_json := row_json->'author';
  select array_agg(k order by k) into got from jsonb_object_keys(profile_json) k;
  assert got=expected_keys and profile_json->>'nickname'='댓글주인',
    'Comment author returns exact profile keys and nickname';

  -- Suspended author: top-level comment hidden, embedded reply hidden, reply_count excludes it.
  assert not exists(
    select 1 from public.pick_comment_page(owner_pick) r
    where r->>'id'=suspended_comment::text
  ), 'Suspended top-level comment stays hidden from anon';
  assert not exists(
    select 1 from jsonb_array_elements(row_json->'replies') rp
    where rp->>'id'=suspended_reply::text
  ), 'Suspended reply is not embedded for anon';
  assert exists(
    select 1 from jsonb_array_elements(row_json->'replies') rp
    where rp->>'id'=blocked_reply::text and rp->'author'->>'nickname'='차단된사람'
  ), 'Reply of a member who only blocked another member is still visible to anon';
  assert (row_json->>'reply_count')::int = 1,
    'reply_count for anon counts only the visible (non-suspended) reply';
  select coalesce(jsonb_agg(r)::text,'') into all_text from public.pick_comment_page(owner_pick) r;
  assert position('비공개사람' in all_text)=0,
    'Suspended nickname never appears in anon pick_comment_page output';
  reset role;

  ------------------------------------- viewer who blocked blocked_u (forward)
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  assert not exists(
    select 1 from public.item_review_page(item_x) r
    where r->>'id'=blocked_pick::text
  ), 'A blocked review cannot expose its author';
  assert not exists(
    select 1 from public.pick_comment_page(owner_pick) r
    where r->>'id'=blocked_comment::text
  ), 'Blocked top-level comment is hidden from the blocker';
  select r into row_json from public.pick_comment_page(owner_pick) r
    where r->>'id'=writer_comment::text;
  assert not exists(
    select 1 from jsonb_array_elements(row_json->'replies') rp
    where rp->>'id' in (blocked_reply::text, suspended_reply::text)
  ), 'Blocked and suspended replies are not embedded for the blocker';
  assert (row_json->>'reply_count')::int = 0,
    'reply_count excludes blocked and suspended replies for the blocker';
  select coalesce(jsonb_agg(r)::text,'') into all_text from public.item_review_page(item_x) r;
  all_text := all_text || coalesce((select jsonb_agg(r)::text from public.pick_comment_page(owner_pick) r),'');
  assert position('차단된사람' in all_text)=0 and position('비공개사람' in all_text)=0,
    'Blocked and suspended nicknames never appear in the blocker''s RPC output';
  reset role;

  ------------------------------- viewer_rev who IS blocked by blocked_u (reverse)
  perform set_config('request.jwt.claim.sub',viewer_rev::text,true);
  set local role authenticated;
  assert not exists(
    select 1 from public.item_review_page(item_x) r
    where r->>'id'=blocked_pick::text
  ), 'Reverse block hides the blocker''s review from the blocked member';
  assert not exists(
    select 1 from public.pick_comment_page(owner_pick) r
    where r->>'id'=blocked_comment::text
  ), 'Reverse block hides the blocker''s top-level comment';
  select r into row_json from public.pick_comment_page(owner_pick) r
    where r->>'id'=writer_comment::text;
  assert not exists(
    select 1 from jsonb_array_elements(row_json->'replies') rp
    where rp->>'id'=blocked_reply::text
  ), 'Reverse block hides the blocker''s reply';
  select coalesce(jsonb_agg(r)::text,'') into all_text from public.item_review_page(item_x) r;
  all_text := all_text || coalesce((select jsonb_agg(r)::text from public.pick_comment_page(owner_pick) r),'');
  assert position('차단된사람' in all_text)=0,
    'Reverse-blocked member never receives the blocker''s nickname';
  reset role;

  ------------------------------------------------------- my_comment_page
  perform set_config('request.jwt.claim.sub',writer_u::text,true);
  set local role authenticated;
  select r into row_json from public.my_comment_page() r
    where r->'comment'->>'id'=writer_comment::text;
  assert row_json->'pick'->'profile'->>'nickname'='가게주인',
    'My comments retain the review-owner nickname';
  assert row_json->'comment'->'author'->>'nickname'='댓글주인',
    'My comments retain the writer nickname';
  select array_agg(k order by k) into got
    from jsonb_object_keys(row_json->'pick'->'profile') k;
  assert got=expected_keys, 'my_comment_page pick.profile uses the same field contract';

  -- Deleted comment: tombstone carries no author, body or nickname, and
  -- drops out of the writer's own comment list.
  perform public.delete_comment(writer_comment_gone);
  assert not exists(
    select 1 from public.my_comment_page() r
    where r->'comment'->>'id'=writer_comment_gone::text
  ), 'Deleted comment leaves my_comment_page';
  reset role;

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select r into row_json from public.pick_comment_page(owner_pick) r
    where r->>'id'=writer_comment_gone::text;
  assert row_json is not null and (row_json->>'is_deleted')::boolean
    and row_json->'author'='null'::jsonb
    and row_json->'user_id'='null'::jsonb
    and row_json->'body'='null'::jsonb,
    'Deleted comment is a tombstone without author, user id or body';
  assert position('댓글주인' in row_json::text)=0,
    'Deleted comment tombstone carries no nickname';
  assert exists(
    select 1 from jsonb_array_elements(row_json->'replies') rp
    where rp->>'id'=owner_reply::text and rp->'author'->>'nickname'='가게주인'
  ), 'Live reply under the tombstone keeps its own author nickname';
  reset role;

  ---------------------------------------------------------- deleted review
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  perform public.delete_pick_review(owner_pick);
  reset role;

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select r into row_json from public.item_review_page(item_x) r
    where r->>'id'=owner_pick::text;
  assert (row_json->>'is_deleted')::boolean
    and row_json->'profile'='null'::jsonb
    and row_json->'user_id'='null'::jsonb,
    'Deleted review remains a tombstone without profile or author id';
  assert position('가게주인' in row_json::text)=0,
    'Deleted review tombstone carries no nickname';
  reset role;

  perform set_config('request.jwt.claim.sub',writer_u::text,true);
  set local role authenticated;
  select r into row_json from public.my_comment_page() r
    where r->'comment'->>'id'=writer_comment::text;
  assert row_json->'pick'->'profile'='null'::jsonb,
    'My comments cannot recover the deleted review author';
  assert position('가게주인' in row_json::text)=0,
    'Deleted review owner nickname is absent from my_comment_page';
  reset role;
end;
$flow$;
$test$, 'Review/comment/my-comment projections preserve nicknames and privacy');
rollback;
