begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  users uuid[] := array(select gen_random_uuid() from generate_series(1,4));
  cat uuid := gen_random_uuid();
  store_item uuid := gen_random_uuid(); online_item uuid := gen_random_uuid();
  both_item uuid := gen_random_uuid(); legacy_item uuid := gen_random_uuid();
  store_pick uuid := gen_random_uuid(); online_pick uuid := gen_random_uuid();
  both_pick uuid := gen_random_uuid(); legacy_pick uuid := gen_random_uuid();
  stamp timestamptz := now() + interval '2 days';
  got uuid[];
  got_channels text[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(users) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'chan_'||substr(replace(id::text,'-',''),1,12),true from unnest(users) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Channel feed','channel-feed-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (store_item,cat,'Store soup','storesoup','active'),
    (online_item,cat,'Online soup','onlinesoup','active'),
    (both_item,cat,'Both soup','bothsoup','active'),
    (legacy_item,cat,'Legacy soup','legacysoup','active');
  insert into public.item_channels(item_id,channel,is_primary) values
    (store_item,'offline',true),
    (online_item,'online',true),
    (both_item,'offline',true),
    (both_item,'online',false);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
    (store_pick,users[1],cat,store_item,'Store reason','active',stamp+interval '4 seconds'),
    (online_pick,users[2],cat,online_item,'Online reason','active',stamp+interval '3 seconds'),
    (both_pick,users[3],cat,both_item,'Both reason','active',stamp+interval '2 seconds'),
    (legacy_pick,users[4],cat,legacy_item,'Legacy reason','active',stamp+interval '1 second');

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page() f where f.category_id=cat;
  assert got=array[store_pick,online_pick,both_pick,legacy_pick], 'The 전체 tab keeps every channel and legacy items';

  select f.channels into got_channels from public.home_pick_feed_page() f where f.pick_id=both_pick;
  assert got_channels=array['offline','online'], 'Rows expose every channel of the item in a stable order';
  select f.channels into got_channels from public.home_pick_feed_page() f where f.pick_id=legacy_pick;
  assert got_channels=array[]::text[], 'Items without a channel expose an empty array, not null';

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page(null,null,'offline') f where f.category_id=cat;
  assert got=array[store_pick,both_pick], 'The 매장 tab returns store-channel items only';

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page(null,null,'online') f where f.category_id=cat;
  assert got=array[online_pick,both_pick], 'The 온라인 tab returns online-channel items only';

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page(stamp+interval '3 seconds',online_pick,'offline') f where f.category_id=cat;
  assert got=array[both_pick], 'Channel filtering keeps the normal cursor contract';

  begin
    perform public.home_pick_feed_page(null,null,'delivery');
    raise exception 'Unknown channel must be rejected';
  exception when sqlstate '22023' then null;
  end;

  reset role;
  assert not exists (
    select 1 from pg_proc
    where proname='home_pick_feed_page' and pronamespace='public'::regnamespace
      and oid<>'public.home_pick_feed_page(timestamptz,uuid,text)'::regprocedure
  ), 'Only the channel-aware overload remains, so two-argument calls stay unambiguous';
end;
$flow$;
$test$, 'Home feed channel tabs: 전체 keeps everything, 매장/온라인 filter server-side with the same cursor');
select * from finish();
rollback;
