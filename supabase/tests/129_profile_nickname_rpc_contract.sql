begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
set local plpgsql.check_asserts = on;

select ok(
  not has_function_privilege('anon', 'private.public_profile_json(public.profiles)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.public_profile_json(public.profiles)', 'EXECUTE'),
  'Private projection helper cannot be called directly by app roles'
);

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid();
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
  row_json jsonb;
  profile_json jsonb;
  expected_keys text[] := array[
    'bio','created_at','id','nickname','onboarding_completed',
    'profile_image_url','updated_at','username'
  ];
  got text[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now()
    from unnest(array[viewer,owner_u,writer_u,blocked_u,suspended_u]) id;
  insert into public.profiles(id,username,nickname,onboarding_completed)
    select id, 'nickrpc_' || substr(replace(id::text,'-',''),1,12),
      case when id=owner_u then '가게주인'
           when id=writer_u then '댓글주인'
           when id=blocked_u then '차단된사람'
           else '비공개사람' end, true
    from unnest(array[viewer,owner_u,writer_u,blocked_u,suspended_u]) id;
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

  perform set_config('request.jwt.claim.sub',writer_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body)
    values(writer_comment,owner_pick,writer_u,'writer comment');
  reset role;

  insert into private.user_moderation(user_id,reason,suspended_at)
    values(suspended_u,'nickname RPC fixture',now());

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

  select r into row_json from public.pick_comment_page(owner_pick) r
    where r->>'id'=writer_comment::text;
  profile_json := row_json->'author';
  select array_agg(k order by k) into got from jsonb_object_keys(profile_json) k;
  assert got=expected_keys and profile_json->>'nickname'='댓글주인',
    'Comment author returns exact profile keys and nickname';
  assert not exists(
    select 1 from public.item_review_page(item_x) r
    where r->>'id'=suspended_pick::text
  ), 'Suspended review stays hidden';
  reset role;

  perform set_config('request.jwt.claim.sub',writer_u::text,true);
  set local role authenticated;
  select r into row_json from public.my_comment_page() r
    where r->'comment'->>'id'=writer_comment::text;
  assert row_json->'pick'->'profile'->>'nickname'='가게주인',
    'My comments retain the review-owner nickname';
  assert row_json->'comment'->'author'->>'nickname'='댓글주인',
    'My comments retain the writer nickname';
  reset role;

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select viewer, blocked_u, username from public.profiles where id=blocked_u;
  assert not exists(
    select 1 from public.item_review_page(item_x) r
    where r->>'id'=blocked_pick::text
  ), 'A blocked review cannot expose its author';
  reset role;

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
  reset role;

  perform set_config('request.jwt.claim.sub',writer_u::text,true);
  set local role authenticated;
  select r into row_json from public.my_comment_page() r
    where r->'comment'->>'id'=writer_comment::text;
  assert row_json->'pick'->'profile'='null'::jsonb,
    'My comments cannot recover the deleted review author';
  reset role;
end;
$flow$;
$test$, 'Review/comment/my-comment projections preserve nicknames and privacy');
rollback;
