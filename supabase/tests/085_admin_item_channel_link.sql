begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
set local plpgsql.check_asserts = on;

create temporary table icl_ids(key text primary key, id uuid not null) on commit drop;
grant select on icl_ids to authenticated, anon;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_root uuid := gen_random_uuid();
  v_soups uuid := gen_random_uuid();
  v_dogani uuid := gen_random_uuid();
  v_lamb uuid := gen_random_uuid();
  v_store_item uuid := gen_random_uuid();
  v_online_item uuid := gen_random_uuid();
  v_second_item uuid := gen_random_uuid();
  v_catalog uuid := gen_random_uuid();
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'icl_admin_'||substr(v_suffix,1,8),true),
    (v_user,'icl_user_'||substr(v_suffix,1,8),true);
  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_root,'연결 테스트 먹을것','iclroot-'||v_suffix,'open',true,false);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (v_soups,v_root,'연결 테스트 국','iclsoup-'||v_suffix,'open',true,false),
    (v_lamb,v_root,'연결 테스트 양고기','icllamb-'||v_suffix,'open',true,true);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    values(v_dogani,v_soups,'연결 테스트 도가니탕','icldogani-'||v_suffix,'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (v_dogani,'internal',true,true,'channel link test'),
    (v_lamb,'internal',true,false,'channel link test');

  insert into public.place_catalog(id,place_provider,provider_place_id,name,normalized_name,road_address,region_1,region_2)
    values(v_catalog,'icltest','icl-'||v_suffix,'연결대성집','연결대성집','서울 종로구 사직로 5','서울','종로구');

  -- Items from the old request → approval path: no channel, place or provider.
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (v_store_item,v_dogani,'연결대성집','연결대성집','active',v_user),
    (v_second_item,v_dogani,'연결대성집 두번째','연결대성집두번째','active',v_user),
    (v_online_item,v_lamb,'연결양고기몰','연결양고기몰','active',v_user);
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at) values
    (v_user,v_dogani,v_store_item,'도가니탕은 여기','active',now()+interval '5 days'),
    (v_user,v_lamb,v_online_item,'양고기는 여기서 주문','active',now()+interval '5 days' - interval '1 second');

  insert into icl_ids values ('admin',v_admin),('user',v_user),('root',v_root),('dogani',v_dogani),('lamb',v_lamb),
    ('store_item',v_store_item),('second_item',v_second_item),('online_item',v_online_item),('catalog',v_catalog);
end;
$fixtures$;

-- Non-admins cannot list or link.
select set_config('request.jwt.claim.sub',(select id::text from icl_ids where key='user'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select public.admin_link_item_to_place((select id from icl_ids where key='store_item'),(select id from icl_ids where key='catalog'))$$,
  '42501', null, 'A normal user cannot link items to places'
);
select throws_ok(
  $$select * from public.admin_unlinked_items()$$,
  '42501', null, 'A normal user cannot list unlinked items'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from icl_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;

select is(
  (select array_agg(u.item_name||':'||u.uses_place_catalog||':'||u.pick_count order by u.item_name)
     from public.admin_unlinked_items((select slug from public.categories where id=(select id from icl_ids where key='root')), null, 50) u),
  array['연결대성집:true:1','연결대성집 두번째:true:0','연결양고기몰:false:1'],
  'The admin list shows channel-less items under the root with place capability and pick counts'
);

select lives_ok($$
  select public.admin_link_item_to_place((select id from icl_ids where key='store_item'),(select id from icl_ids where key='catalog'))
$$, 'An AAL2 admin links an existing item to a place');

select lives_ok($$
  select public.admin_link_item_to_online_provider((select id from icl_ids where key='online_item'),'연결양고기몰','official_site','https://icl-lamb.example/shop')
$$, 'An AAL2 admin links an existing item to an online store');

-- items_provider_consistency is deferred; force it now instead of at a commit that never happens.
select lives_ok($$set constraints all immediate$$, 'Both links satisfy the deferred item/provider/place invariants');

select throws_ok(
  $$select public.admin_link_item_to_place((select id from icl_ids where key='second_item'),(select id from icl_ids where key='catalog'))$$,
  'P0001', 'PLACE_ALREADY_LINKED', 'A place keeps one canonical item per category'
);

select throws_ok(
  $$select public.admin_link_item_to_place((select id from icl_ids where key='store_item'),(select id from icl_ids where key='catalog'))$$,
  'P0001', 'ITEM_ALREADY_LINKED', 'An item is linked only once'
);
reset role;

-- Checked as the table owner after the admin transaction steps.
select lives_ok($test$
do $flow$
declare
  v_store uuid := (select id from icl_ids where key='store_item');
  v_online uuid := (select id from icl_ids where key='online_item');
  v_dogani uuid := (select id from icl_ids where key='dogani');
  v_catalog uuid := (select id from icl_ids where key='catalog');
  v_item public.items%rowtype;
  got text[];
begin
  select * into v_item from public.items where id=v_store;
  assert v_item.external_source='onepick_place' and v_item.name='연결대성집' and v_item.status='active', 'The store item keeps its row and name';
  assert exists(select 1 from public.item_places ip join public.providers pr on pr.place_id=ip.place_id
    join public.item_providers ipr on ipr.item_id=ip.item_id and ipr.provider_id=pr.id
    where ip.item_id=v_store and pr.kind='offline_branch'), 'The store item maps to its place''s offline provider';
  assert exists(select 1 from public.item_channels where item_id=v_store and channel='offline' and is_primary), 'offline channel';
  assert (select count(*) from public.picks where item_id=v_store and status='active')=1, 'Existing Picks stay';
  assert private.item_accepts_pick(v_store), 'The linked store item still accepts new Picks';

  select * into v_item from public.items where id=v_online;
  assert v_item.external_source='onepick_provider', 'online source';
  assert exists(select 1 from public.item_channels where item_id=v_online and channel='online' and target_url='https://icl-lamb.example/shop'), 'online channel';

  -- The refactored user place selection reuses the linked item for the same place.
  perform set_config('request.jwt.claim.sub',(select id::text from icl_ids where key='user'),true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  assert (private.select_place_catalog_item_impl(v_dogani,v_catalog)).id=v_store, 'Selecting the same place returns the linked item';

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg(f.item_name order by f.item_name) into got
    from public.home_pick_feed_page(null,null,'offline') f where f.item_id in (v_store,v_online);
  assert got=array['연결대성집'], 'The store Pick now appears under 매장';
  select array_agg(f.item_name order by f.item_name) into got
    from public.home_pick_feed_page(null,null,'online') f where f.item_id in (v_store,v_online);
  assert got=array['연결양고기몰'], 'The online Pick now appears under 온라인';
  reset role;
end;
$flow$;
$test$, 'Linked items keep their Picks and show up under the 매장/온라인 tabs');

select set_config('request.jwt.claim.sub',(select id::text from icl_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select is(
  (select array_agg(u.item_name) from public.admin_unlinked_items((select slug from public.categories where id=(select id from icl_ids where key='root')), null, 50) u),
  array['연결대성집 두번째'],
  'Linked items leave the admin list'
);
reset role;

select * from finish();
rollback;
