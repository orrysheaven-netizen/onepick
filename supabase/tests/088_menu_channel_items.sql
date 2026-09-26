begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
set local plpgsql.check_asserts = on;

create temporary table mci_ids(key text primary key, id uuid not null) on commit drop;
grant select on mci_ids to authenticated, anon;

do $fixtures$
declare
  u uuid[] := array(select gen_random_uuid() from generate_series(1,4));
  v_root uuid := gen_random_uuid();
  v_soup uuid := gen_random_uuid();
  v_place uuid := gen_random_uuid();
  v_hidden_place uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_hidden_store uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_new_online uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(u) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'mci_'||substr(replace(id::text,'-',''),1,12),true from unnest(u) id;

  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_root,'메뉴채널 루트','mciroot-'||v_suffix,'open',true,false);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    values(v_soup,v_root,'메뉴채널 미역국','mcisoup-'||v_suffix,'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes)
    values(v_soup,'internal',true,true,'menu channel test');

  insert into public.places(id,name,road_address,place_provider,provider_place_id,is_visible) values
    (v_place,'메뉴채널 미역국집','서울 종로구 미역로 1','mcitest','mci-'||v_suffix,true),
    (v_hidden_place,'숨긴 미역국집','서울 종로구 미역로 2','mcitest','mci-hidden-'||v_suffix,false);

  insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id) values
    (v_store,v_soup,'메뉴채널 미역국집','메뉴채널미역국집','active','onepick_place',v_place::text||':'||v_soup::text),
    (v_hidden_store,v_soup,'숨긴 미역국집','숨긴미역국집','active','onepick_place',v_hidden_place::text||':'||v_soup::text);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (v_online,v_soup,'미역국 택배몰','미역국택배몰','active'),
    (v_new_online,v_soup,'새 미역국몰','새미역국몰','active'),
    (v_product,v_soup,'채널 없는 미역','채널없는미역','active');
  -- Place links create the offline providers (item_places_sync_provider).
  insert into public.item_places(item_id,category_id,place_id) values
    (v_store,v_soup,v_place),(v_hidden_store,v_soup,v_hidden_place);
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at) values
    (u[1],v_soup,v_online,'r','active',now()),
    (u[2],v_soup,v_online,'r','active',now()),
    (u[3],v_soup,v_store,'r','active',now()),
    (u[4],v_soup,v_product,'r','active',now());
  insert into public.item_channels(item_id,channel,target_url,is_primary) values
    (v_store,'offline',null,true),
    (v_hidden_store,'offline',null,true),
    (v_online,'online','https://shop.example.com/miyeok',true),
    (v_new_online,'online','https://shop.example.com/new',true);

  insert into mci_ids values ('soup',v_soup),('online',v_online);
end;
$fixtures$;

select set_config('request.jwt.claim.sub','',true);
set local role anon;

select is(
  (select array_agg(m.channel||':'||m.item_name||':'||m.pick_count order by m.channel, m.pick_count desc, m.item_name)
     from public.explore_menu_channel_items((select id from mci_ids where key='soup')) m),
  array['offline:메뉴채널 미역국집:1','online:미역국 택배몰:2','online:새 미역국몰:0'],
  'Visible store and online items per channel; hidden places and channel-less items are left out'
);
select is(
  (select array_agg(m.item_id) from public.explore_menu_channel_items((select id from mci_ids where key='soup'),1) m
    where m.channel='online'),
  array[(select id from mci_ids where key='online')],
  'p_limit applies per channel, most-picked first'
);
select is(
  (select count(*)::int from public.explore_menu_channel_items(gen_random_uuid())),
  0, 'Unknown menu returns nothing'
);
reset role;

select ok(
  not (select prosecdef from pg_proc where oid='public.explore_menu_channel_items(uuid,integer)'::regprocedure),
  'No security-definer RLS bypass'
);
select is(
  (select c.parent_id from public.categories c where c.slug='miyeokguk'),
  (select id from public.categories where slug='food-soups-rice'),
  '미역국 is a soup menu'
);

select * from finish();
rollback;
