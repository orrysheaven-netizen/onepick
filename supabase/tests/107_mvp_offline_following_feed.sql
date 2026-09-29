begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid();
  friend uuid := gen_random_uuid();
  food_menu uuid := gen_random_uuid();
  other_root uuid := gen_random_uuid();
  other_leaf uuid := gen_random_uuid();
  offline_item uuid := gen_random_uuid();
  online_item uuid := gen_random_uuid();
  other_item uuid := gen_random_uuid();
  offline_pick uuid := gen_random_uuid();
  online_pick uuid := gen_random_uuid();
  other_pick uuid := gen_random_uuid();
  stamp timestamptz := now() + interval '1 day';
  got uuid[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,friend]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'mvp_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,friend]) id;

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_menu, food.id, 'MVP 오프라인 메뉴', 'mvp-offline-menu-'||food_menu, 'open', true, true, 999
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order) values
    (other_root,null,'MVP 기타','mvp-other-root-'||other_root,'open',true,false,999),
    (other_leaf,other_root,'MVP 기타 메뉴','mvp-other-leaf-'||other_leaf,'open',true,true,1);

  insert into public.items(id,category_id,name,normalized_name,status) values
    (offline_item,food_menu,'MVP offline','mvp offline','active'),
    (online_item,food_menu,'MVP online','mvp online','active'),
    (other_item,other_leaf,'MVP other','mvp other','active');

  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at) values
    (online_pick,friend,food_menu,online_item,'online','online','active',stamp + interval '3 seconds'),
    (offline_pick,friend,food_menu,offline_item,'offline','offline','active',stamp + interval '2 seconds'),
    (other_pick,friend,other_leaf,other_item,null,'other','active',stamp + interval '1 second');
  insert into public.item_channels(item_id,channel,is_primary) values
    (offline_item,'offline',true),
    (online_item,'online',true);
  insert into public.item_editorial_features(item_id,priority,note,is_active) values
    (offline_item,10,'offline editorial',true),
    (online_item,20,'online editorial',true);

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(viewer,friend);

  select array_agg(f.pick_id order by f.started_at desc, f.pick_id desc) into got
    from public.home_following_feed_page(null,null,'offline','food') f;
  assert got=array[offline_pick], 'MVP scope returns food + offline only';

  select array_agg(e.item_id order by e.editorial_priority) into got
    from public.home_editorial_items(6,'offline','food') e;
  assert got=array[offline_item], 'MVP editorial scope returns offline food items only';
  assert (select pick_count from public.home_editorial_items(6,'offline','food') where item_id=offline_item)=1,
    'MVP editorial count excludes hidden channels';

  select array_agg(e.item_id order by e.editorial_priority) into got
    from public.home_editorial_items(6,'online','food') e;
  assert got=array[online_item], 'Online editorial remains available internally for later rollout';

  select array_agg(f.pick_id order by f.started_at desc, f.pick_id desc) into got
    from public.home_following_feed_page(null,null,'online','food') f;
  assert got=array[online_pick], 'Online remains available internally for later rollout';

  select array_agg(f.pick_id order by f.started_at desc, f.pick_id desc) into got
    from public.home_following_feed_page(null,null,null,'food') f;
  assert got=array[online_pick,offline_pick], 'Root-only scope keeps every food channel';

  select array_agg(f.pick_id order by f.started_at desc, f.pick_id desc) into got
    from public.home_following_feed_page() f;
  assert got=array[online_pick,offline_pick,other_pick], 'Default call preserves the full internal feed';

  begin
    perform * from public.home_following_feed_page(null,null,'invalid',null);
    assert false, 'Invalid channel must fail';
  exception when sqlstate '22023' then
    null;
  end;

  reset role;
  assert not has_function_privilege('anon','public.home_following_feed_page(timestamptz,uuid,text,text)','execute'),
    'Guests cannot call the following feed';
  assert has_function_privilege('authenticated','public.home_following_feed_page(timestamptz,uuid,text,text)','execute'),
    'Authenticated users can call the scoped following feed';
  assert not (select prosecdef from pg_proc where oid='public.home_following_feed_page(timestamptz,uuid,text,text)'::regprocedure),
    'Following feed remains SECURITY INVOKER';
  assert has_function_privilege('anon','public.home_editorial_items(integer,text,text)','execute'),
    'Editorial recommendations remain public';
  assert not (select prosecdef from pg_proc where oid='public.home_editorial_items(integer,text,text)'::regprocedure),
    'Editorial feed remains SECURITY INVOKER';
  assert to_regprocedure('public.home_following_feed_page(timestamptz,uuid)') is null,
    'Old overload is removed so callers cannot bypass the new scope contract accidentally';
  assert to_regprocedure('public.home_editorial_items(integer)') is null,
    'Old editorial overload is removed so scoped callers use one canonical function';
end;
$flow$;
$test$, 'Following feed supports food/offline MVP scope without deleting future channels');

select * from finish();
rollback;
