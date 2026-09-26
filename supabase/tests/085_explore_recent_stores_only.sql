begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  u uuid[] := array(select gen_random_uuid() from generate_series(1,4));
  cat uuid := gen_random_uuid();
  store_item uuid := gen_random_uuid(); online_item uuid := gen_random_uuid();
  product_item uuid := gen_random_uuid(); newer_product uuid := gen_random_uuid();
  -- pgTAP runs in one transaction, so now() is constant: age rows explicitly.
  stamp timestamptz := now() + interval '1 day';
  got uuid[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(u) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'stores_'||substr(replace(id::text,'-',''),1,12),true from unnest(u) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Stores only','stores-only-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (store_item,cat,'Store','store','active'),
    (online_item,cat,'Online store','online store','active'),
    (product_item,cat,'Packaged product','packaged product','active'),
    (newer_product,cat,'Newer product','newer product','active');
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at) values
    (u[1],cat,store_item,'r','active',stamp+interval '1 second'),
    (u[2],cat,online_item,'r','active',stamp+interval '2 seconds'),
    (u[3],cat,product_item,'r','active',stamp+interval '3 seconds'),
    (u[4],cat,newer_product,'r','active',stamp+interval '4 seconds');
  -- Channels after Picks: a store channel otherwise requires a linked place.
  insert into public.item_channels(item_id,channel,is_primary) values
    (store_item,'offline',true),
    (online_item,'online',true);

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page(array[cat]) f;
  assert got=array[newer_product,product_item,online_item,store_item], 'Default keeps every item (existing callers unchanged)';
  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page(array[cat],null,null,true) f;
  assert got=array[online_item,store_item], 'Stores only: items with a 매장 or 온라인 channel, newest first';
  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page(array[cat],stamp+interval '2 seconds',online_item,true) f;
  assert got=array[store_item], 'Cursor pages within the stores-only list';
  reset role;
  assert not (select prosecdef from pg_proc where oid='public.explore_recent_items_page(uuid[],timestamptz,uuid,boolean)'::regprocedure),
    'No security-definer RLS bypass';
  assert to_regprocedure('public.explore_recent_items_page(uuid[],timestamptz,uuid)') is null,
    'The old 3-argument overload is gone (no ambiguous calls)';
end;
$flow$;
$test$, 'Explore recent items: stores-only filter by item channel');
select * from finish();
rollback;
