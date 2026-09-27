begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); friend uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  plain_cat uuid := gen_random_uuid(); legacy_cat uuid := gen_random_uuid();
  online_store uuid := gen_random_uuid(); store_only uuid := gen_random_uuid();
  plain_item uuid := gen_random_uuid(); legacy_item uuid := gen_random_uuid();
  online_pick uuid := gen_random_uuid(); offline_pick uuid := gen_random_uuid();
  plain_pick uuid := gen_random_uuid(); legacy_pick uuid := gen_random_uuid();
  stamp timestamptz := now() + interval '1 day';
  got text[]; all_got uuid[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,friend]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'ffc_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,friend]) id;

  -- One food menu (food → group → leaf) and two plain categories: a member holds
  -- one current Pick per category (per channel for food), so each plain Pick needs its own.
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'FFC 그룹', 'ffc-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu, food_group, 'FFC 국', 'ffc-soup', 'open', true, true, 900);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (plain_cat,'FFC plain','ffc-plain-'||plain_cat,'open',true,true),
    (legacy_cat,'FFC legacy','ffc-legacy-'||legacy_cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (online_store,menu,'FFC online soup','ffc online soup','active'),
    (store_only,menu,'FFC store soup','ffc store soup','active'),
    (plain_item,plain_cat,'FFC plain product','ffc plain product','active'),
    (legacy_item,legacy_cat,'FFC legacy product','ffc legacy product','active');

  -- Food Picks carry their own channel; plain Picks have none. Channels are
  -- attached after the Picks: a store channel otherwise requires a linked place.
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at) values
    (online_pick,friend,menu,online_store,'online','Online reason','active',stamp + interval '4 seconds'),
    (offline_pick,friend,menu,store_only,'offline','Store reason','active',stamp + interval '3 seconds'),
    (plain_pick,friend,plain_cat,plain_item,null,'Plain reason','active',stamp + interval '2 seconds'),
    (legacy_pick,friend,legacy_cat,legacy_item,null,'Legacy reason','active',stamp + interval '1 second');
  insert into public.item_channels(item_id,channel,is_primary) values
    (online_store,'online',true),
    (online_store,'offline',false),
    (store_only,'offline',true),
    (plain_item,'offline',true),
    (plain_item,'online',false);
  insert into public.user_follows(follower_id,followee_id) values(viewer,friend);

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;

  select array_agg(f.pick_id order by f.started_at desc, f.pick_id desc) into all_got
    from public.home_following_feed_page() f;
  assert all_got=array[online_pick,offline_pick,plain_pick,legacy_pick], 'Same rows and order as before the channel column';

  select f.channels into got from public.home_following_feed_page() f where f.pick_id=online_pick;
  assert got=array['online'], 'A food Pick shows the channel it was picked under, not every channel of the item';
  select f.channels into got from public.home_following_feed_page() f where f.pick_id=offline_pick;
  assert got=array['offline'], 'A store Pick shows offline';
  select f.channels into got from public.home_following_feed_page() f where f.pick_id=plain_pick;
  assert got=array['offline','online'], 'A Pick without its own channel exposes the item channels in a stable order';
  select f.channels into got from public.home_following_feed_page() f where f.pick_id=legacy_pick;
  assert got=array[]::text[], 'Items without a channel expose an empty array, not null';

  reset role;
  assert not has_function_privilege('anon','public.home_following_feed_page(timestamptz,uuid)','execute'), 'Guests still cannot call the following feed';
  assert not (select prosecdef from pg_proc where oid='public.home_following_feed_page(timestamptz,uuid)'::regprocedure), 'Feed still runs under caller RLS';
end;
$flow$;
$test$, 'Following feed exposes the Pick channel with the same rule as the people feed');
select * from finish();
rollback;
