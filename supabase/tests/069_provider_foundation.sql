begin;

create extension if not exists pgtap with schema extensions;
select plan(4);
set local plpgsql.check_asserts = on;

-- Shared fixtures ----------------------------------------------------------
create temporary table pf_ids (key text primary key, id uuid not null) on commit drop;
grant select on pf_ids to anon, authenticated;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_cat_legacy uuid := gen_random_uuid();
  v_cat_movie uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now()),
    (v_user2,'authenticated','authenticated',now(),now());

  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'pf_admin_'||substr(replace(v_admin::text,'-',''),1,8),true),
    (v_user,'pf_user_'||substr(replace(v_user::text,'-',''),1,8),true),
    (v_user2,'pf_user2_'||substr(replace(v_user2::text,'-',''),1,8),true);

  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_cat_a,'간장게장 테스트','pf-a-'||substr(replace(v_cat_a::text,'-',''),1,8),'open',true,true),
    (v_cat_b,'양념게장 테스트','pf-b-'||substr(replace(v_cat_b::text,'-',''),1,8),'open',true,true),
    (v_cat_legacy,'김치 테스트','pf-legacy-'||substr(replace(v_cat_legacy::text,'-',''),1,8),'open',true,true),
    (v_cat_movie,'영화 테스트','pf-movie-'||substr(replace(v_cat_movie::text,'-',''),1,8),'open',true,true);

  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (v_cat_a,'internal',true,true,'Provider fixture A'),
    (v_cat_b,'internal',true,true,'Provider fixture B'),
    (v_cat_legacy,'internal',true,false,'Legacy broad food fixture');

  insert into pf_ids values
    ('admin',v_admin),('user',v_user),('user2',v_user2),
    ('cat_a',v_cat_a),('cat_b',v_cat_b),('cat_legacy',v_cat_legacy),('cat_movie',v_cat_movie);
end;
$fixtures$;

-- 1. Backfill of pre-existing place-backed data ------------------------------
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_user uuid := (select id from pf_ids where key='user');
  v_cat_a uuid := (select id from pf_ids where key='cat_a');
  v_cat_legacy uuid := (select id from pf_ids where key='cat_legacy');
  v_cat_movie uuid := (select id from pf_ids where key='cat_movie');
  v_place uuid := gen_random_uuid();
  v_hidden_place uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_hidden_item uuid := gen_random_uuid();
  v_legacy_item uuid := gen_random_uuid();
  v_movie_item uuid := gen_random_uuid();
  v_pick public.picks%rowtype;
  v_legacy_pick public.picks%rowtype;
  v_after public.picks%rowtype;
  v_provider public.providers%rowtype;
  v_version_before integer;
  v_version_after integer;
  v_audit_before bigint;
  v_audit_after bigint;
  v_linked integer;
begin
  -- Recreate the pre-migration shape: a place item without the sync trigger.
  alter table public.item_places disable trigger item_places_sync_provider;
  alter table public.item_places disable trigger item_places_provider_consistency;

  insert into public.places(id,name,branch_name,road_address,region_1,region_2,place_provider,provider_place_id,is_visible) values
    (v_place,'기존게장집','마포점','서울 마포구 기존로 1','서울','마포구','pftest','legacy-1',true),
    (v_hidden_place,'숨김게장집',null,'서울 중구 숨김로 1','서울','중구','pftest','legacy-hidden',false);

  insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id) values
    (v_item,v_cat_a,'기존게장집','기존게장집','active','onepick_place',v_place::text||':'||v_cat_a::text),
    (v_hidden_item,v_cat_a,'숨김게장집','숨김게장집','active','onepick_place',v_hidden_place::text||':'||v_cat_a::text);
  insert into public.item_places(item_id,category_id,place_id) values
    (v_item,v_cat_a,v_place),(v_hidden_item,v_cat_a,v_hidden_place);
  insert into public.item_channels(item_id,channel,is_primary) values
    (v_item,'offline',true),(v_hidden_item,'offline',true);

  -- Legacy broad food item and a content item: never provider-backed.
  insert into public.items(id,category_id,name,normalized_name,status) values
    (v_legacy_item,v_cat_legacy,'엄마김치','엄마김치','active');
  insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id) values
    (v_movie_item,v_cat_movie,'기존영화','기존영화','active','tmdb','pf-'||v_movie_item::text);

  alter table public.item_places enable trigger item_places_sync_provider;
  alter table public.item_places enable trigger item_places_provider_consistency;

  assert not exists(select 1 from public.item_providers where item_id=v_item),
    'Fixture starts as a pre-migration place item';

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  v_pick := public.change_pick(v_cat_a,v_item,'간장맛 때문에 몇 년째');
  v_legacy_pick := public.change_pick(v_cat_legacy,v_legacy_item,'레거시 김치 원픽');
  reset role;

  select source_version into v_version_before
  from public.profile_ai_generation_limits where profile_id=v_user;
  select count(*) into v_audit_before from public.admin_audit_logs;

  v_linked := private.backfill_place_providers();
  assert v_linked=2, 'Backfill links both pre-existing place items';

  select pr.* into v_provider
  from public.providers pr where pr.place_id=v_place;
  assert v_provider.kind='offline_branch'
     and v_provider.status='active'
     and v_provider.name='기존게장집'
     and v_provider.branch_name='마포점'
     and v_provider.brand_id is null,
    'Visible place becomes an active offline provider with its name and branch';
  assert (select provider_id from public.item_providers where item_id=v_item)=v_provider.id,
    'Existing place item is linked to its place provider';
  assert (select status from public.providers where place_id=v_hidden_place)='active',
    'Place providers start active; visibility stays with the place';
  assert not private.item_accepts_pick(v_hidden_item),
    'Item at an invisible place stays unpickable, as before';

  select * into v_after from public.picks where id=v_pick.id;
  assert v_after.status='active' and v_after.item_id=v_item and v_after.category_id=v_cat_a
     and v_after.one_line_review='간장맛 때문에 몇 년째',
    'Existing pick keeps its id, item, category, status and review';
  assert (select status from public.picks where id=v_legacy_pick.id)='active',
    'Legacy broad-category pick is untouched';
  assert not exists(select 1 from public.item_providers where item_id in (v_legacy_item,v_movie_item)),
    'Legacy food and content items stay provider-less';

  select source_version into v_version_after
  from public.profile_ai_generation_limits where profile_id=v_user;
  select count(*) into v_audit_after from public.admin_audit_logs;
  assert v_version_after is not distinct from v_version_before,
    'Linking providers does not invalidate AI profile reviews';
  assert v_audit_after=v_audit_before,
    'Backfill writes no admin audit entries';

  assert private.backfill_place_providers()=0, 'Backfill is idempotent';
  assert (select count(*) from public.providers where place_id in (v_place,v_hidden_place))=2,
    'Re-running backfill creates no extra providers';

  set constraints all immediate;
  set constraints all deferred;

  insert into pf_ids values
    ('legacy_place',v_place),('legacy_item',v_item),('legacy_provider',v_provider.id),
    ('hidden_item',v_hidden_item),('hidden_place',v_hidden_place),('legacy_food_item',v_legacy_item),('movie_item',v_movie_item),
    ('offline_pick',v_pick.id);
end;
$flow$;
$test$, 'Backfill links existing place items to providers without touching items, picks or AI state');

-- 2. New offline providers through the unchanged place functions -------------
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_admin uuid := (select id from pf_ids where key='admin');
  v_user uuid := (select id from pf_ids where key='user');
  v_cat_a uuid := (select id from pf_ids where key='cat_a');
  v_cat_b uuid := (select id from pf_ids where key='cat_b');
  v_catalog uuid := gen_random_uuid();
  v_gangnam public.items%rowtype;
  v_busan public.items%rowtype;
  v_gangnam_b public.items%rowtype;
  v_catalog_a public.items%rowtype;
  v_catalog_b public.items%rowtype;
  v_catalog_a_again public.items%rowtype;
begin
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;

  v_gangnam := public.admin_upsert_place_item(
    v_cat_a,'OO게장','강남점','pftest','oo-gangnam',
    '서울 강남구 게장로 1',null,'서울','강남구',37.5,127.0,'https://maps.example/oo-gangnam');
  v_busan := public.admin_upsert_place_item(
    v_cat_a,'OO게장','부산점','pftest','oo-busan',
    '부산 해운대구 게장로 2',null,'부산','해운대구',35.1,129.0,'https://maps.example/oo-busan');
  v_gangnam_b := public.admin_upsert_place_item(
    v_cat_b,'OO게장','강남점','pftest','oo-gangnam',
    '서울 강남구 게장로 1',null,'서울','강남구',37.5,127.0,'https://maps.example/oo-gangnam');
  reset role;

  assert v_gangnam.id<>v_busan.id, 'Same brand name, different branch: different items';
  assert (select provider_id from public.item_providers where item_id=v_gangnam.id) is not null
     and (select provider_id from public.item_providers where item_id=v_busan.id) is not null,
    'Admin place upsert attaches a provider';
  assert (select provider_id from public.item_providers where item_id=v_gangnam.id)
       <>(select provider_id from public.item_providers where item_id=v_busan.id),
    'Different branches are different providers';
  assert (select provider_id from public.item_providers where item_id=v_gangnam.id)
       =(select provider_id from public.item_providers where item_id=v_gangnam_b.id),
    'One provider can offer several fine categories';
  assert (select count(*) from public.item_providers where provider_id=(select provider_id from public.item_providers where item_id=v_gangnam.id))=2,
    'Provider category list is its items';

  insert into public.place_catalog(
    id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,region_1,region_2,latitude,longitude,provider_category,business_status,source_updated_at
  ) values (
    v_catalog,'pftest','catalog-1','진미식당','진미식당','마포점',
    '서울 마포구 진미로 1','서울','마포구',37.55,126.9,'한식','open',now()
  );

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  v_catalog_a := public.select_place_catalog_item(v_cat_a,v_catalog);
  v_catalog_b := public.select_place_catalog_item(v_cat_b,v_catalog);
  v_catalog_a_again := public.select_place_catalog_item(v_cat_a,v_catalog);
  reset role;

  assert v_catalog_a.id=v_catalog_a_again.id, 'Re-selecting a catalog place reuses the item';
  assert (select provider_id from public.item_providers where item_id=v_catalog_a.id)
       =(select provider_id from public.item_providers where item_id=v_catalog_b.id),
    'User place selection in two categories reuses one provider';
  assert (select p.kind||':'||p.status from public.providers p
          join public.item_providers i on i.provider_id=p.id where i.item_id=v_catalog_a.id)='offline_branch:active',
    'User place selection creates an active offline provider';

  set constraints all immediate;
  set constraints all deferred;

  insert into pf_ids values
    ('gangnam_item',v_gangnam.id),('busan_item',v_busan.id),('gangnam_b_item',v_gangnam_b.id),
    ('gangnam_provider',(select provider_id from public.item_providers where item_id=v_gangnam.id)),
    ('busan_provider',(select provider_id from public.item_providers where item_id=v_busan.id)),
    ('catalog_item',v_catalog_a.id);
end;
$flow$;
$test$, 'Existing place functions create and reuse offline providers per place');

-- 3. Online providers, brands, pick gate and invariants ---------------------
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_user uuid := (select id from pf_ids where key='user');
  v_cat_a uuid := (select id from pf_ids where key='cat_a');
  v_cat_b uuid := (select id from pf_ids where key='cat_b');
  v_cat_movie uuid := (select id from pf_ids where key='cat_movie');
  v_legacy_item uuid := (select id from pf_ids where key='legacy_item');
  v_offline_pick uuid := (select id from pf_ids where key='offline_pick');
  v_gangnam_item uuid := (select id from pf_ids where key='gangnam_item');
  v_busan_item uuid := (select id from pf_ids where key='busan_item');
  v_gangnam_b_item uuid := (select id from pf_ids where key='gangnam_b_item');
  v_user2 uuid := (select id from pf_ids where key='user2');
  v_cat_legacy uuid := (select id from pf_ids where key='cat_legacy');
  v_catalog_item uuid := (select id from pf_ids where key='catalog_item');
  v_branded_item uuid := gen_random_uuid();
  v_spare_place uuid := gen_random_uuid();
  v_gangnam_provider uuid := (select id from pf_ids where key='gangnam_provider');
  v_busan_provider uuid := (select id from pf_ids where key='busan_provider');
  v_movie_item uuid := (select id from pf_ids where key='movie_item');
  v_brand uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_store2 uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_online2 uuid := gen_random_uuid();
  v_online_item uuid := gen_random_uuid();
  v_online_item2 uuid := gen_random_uuid();
  v_pick public.picks%rowtype;
  v_count bigint;
begin
  -- Online store providers (PR 0b adds the admin RPC; rows are inserted directly here).
  insert into public.online_stores(id,store_type,host,platform,store_key,official_url) values
    (v_store,'official_site','oogejang.example',null,'site:oogejang.example','https://oogejang.example'),
    (v_store2,'platform_store','smartstore.naver.com','naver_smartstore','naver_smartstore:xxsusan','https://smartstore.naver.com/xxsusan');
  insert into public.providers(id,kind,name,online_store_id,status) values
    (v_online,'online_store','OO게장 공식몰',v_store,'active'),
    (v_online2,'online_store','OO게장',v_store2,'active');
  insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id) values
    (v_online_item,v_cat_a,'OO게장 공식몰','oo게장공식몰','active','onepick_provider',v_online::text||':'||v_cat_a::text),
    (v_online_item2,v_cat_a,'OO게장','oo게장','active','onepick_provider',v_online2::text||':'||v_cat_a::text);
  insert into public.item_providers(item_id,category_id,provider_id) values
    (v_online_item,v_cat_a,v_online),(v_online_item2,v_cat_a,v_online2);
  insert into public.item_channels(item_id,channel,target_url,is_primary) values
    (v_online_item,'online','https://oogejang.example',true);

  assert exists(select 1 from public.items where id=v_online_item2),
    'Provider-backed items are not deduplicated by display name';

  -- One brand over two branches and an official store.
  insert into public.brands(id,name,normalized_name) values (v_brand,'OO게장','pf-oo게장-'||substr(replace(v_brand::text,'-',''),1,8));
  update public.providers set brand_id=v_brand where id in (v_gangnam_provider,v_busan_provider,v_online);
  assert (select count(*) from public.providers where brand_id=v_brand)=3,
    'A brand groups several branches and an online store';

  set constraints all immediate;
  set constraints all deferred;

  -- Picks move between offline and online candidates of one category.
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  v_pick := public.change_pick(v_cat_a,v_online_item,'온라인으로 주문해서 먹는 게장');
  reset role;
  assert v_pick.status='active' and v_pick.item_id=v_online_item, 'Online provider item is pickable';
  assert (select status from public.picks where id=v_offline_pick)='replaced',
    'Offline pick in the same category is replaced by the online pick';
  select count(*) into v_count from public.picks
  where user_id=v_user and category_id=v_cat_a and status in ('active','needs_review');
  assert v_count=1, 'Still exactly one current pick per category';

  -- Inactive providers block new picks but keep existing ones.
  update public.providers set status='hidden' where id=v_busan_provider;
  update public.providers set status='pending' where id=v_online2;
  set local role authenticated;
  begin
    perform public.change_pick(v_cat_a,v_busan_item,'숨김 지점');
    assert false,'Hidden provider must not accept picks';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PLACE_IDENTITY_REQUIRED','Hidden provider is rejected by the pick gate';
  end;
  begin
    perform public.change_pick(v_cat_a,v_online_item2,'대기 중 몰');
    assert false,'Pending provider must not accept picks';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PLACE_IDENTITY_REQUIRED','Pending provider is rejected by the pick gate';
  end;
  v_pick := public.change_pick(v_cat_movie,v_movie_item,'콘텐츠 원픽은 그대로');
  reset role;
  assert v_pick.status='active', 'Content items without a provider stay pickable';

  update public.providers set status='active' where id=v_busan_provider;

  -- Hiding and re-showing a place gates picks exactly as before providers.
  update public.places set is_visible=false
  where id=(select place_id from public.providers where id=v_gangnam_provider);
  perform set_config('request.jwt.claim.sub',v_user2::text,true);
  set local role authenticated;
  begin
    perform public.change_pick(v_cat_b,v_gangnam_b_item,'숨김 장소');
    assert false,'Item at a hidden place must not accept picks';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PLACE_IDENTITY_REQUIRED','Hidden place is rejected by the pick gate';
  end;
  assert not exists(select 1 from public.providers where id=v_gangnam_provider),
    'Provider at a hidden place is not readable by signed-in users';
  reset role;
  update public.places set is_visible=true
  where id=(select place_id from public.providers where id=v_gangnam_provider);
  set local role authenticated;
  v_pick := public.change_pick(v_cat_b,v_gangnam_b_item,'다시 공개된 장소');
  reset role;
  assert v_pick.status='active','Re-showing the place makes its items pickable again';
  perform set_config('request.jwt.claim.sub',v_user::text,true);

  -- Structural invariants.
  begin
    insert into public.providers(kind,name,online_store_id) values ('offline_branch','틀린 종류',v_store);
    assert false,'Offline provider without a place must fail';
  exception when check_violation then null;
  end;

  begin
    with dup as (
      insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
      values (v_cat_a,'중복','중복','active','onepick_provider','dup-'||gen_random_uuid()::text)
      returning id,category_id
    )
    insert into public.item_providers(item_id,category_id,provider_id)
    select id,category_id,v_online from dup;
    assert false,'Second item for the same provider and category must fail';
  exception when unique_violation then null;
  end;

  begin
    set constraints all immediate;
    insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id,brand_id)
    values (v_branded_item,v_cat_b,'브랜드 상품','브랜드상품','pending','onepick_provider','branded-'||v_branded_item::text,v_brand);
    insert into public.item_providers(item_id,category_id,provider_id) values (v_branded_item,v_cat_b,v_online);
    assert false,'A branded item must not be mapped to a provider';
  exception when check_violation then
    assert sqlerrm='ITEM_PROVIDER_BRAND_CONFLICT','Brand comes through the provider only';
  end;
  set constraints all deferred;

  begin
    set constraints all immediate;
    update public.item_providers set provider_id=v_online where item_id=v_gangnam_b_item;
    assert false,'An offline-source item cannot move to an online provider';
  exception when check_violation then
    assert sqlerrm='ONLINE_PROVIDER_ITEM_SOURCE_INVALID',
      'Online provider items require onepick_provider source';
  end;
  set constraints all deferred;

  -- Legacy name de-duplication is unchanged for provider-less items.
  insert into public.items(category_id,name,normalized_name,status)
  values (v_cat_legacy,'중복김치','중복김치','active');
  begin
    insert into public.items(category_id,name,normalized_name,status)
    values (v_cat_legacy,'중복 김치','중복김치','active');
    assert false,'Provider-less internal items still dedupe by name';
  exception when unique_violation then
    assert sqlerrm='ITEM_DUPLICATE','Expected ITEM_DUPLICATE';
  end;

  -- Deleting a place-backed item cascades its mappings without tripping the checks.
  set constraints all immediate;
  delete from public.items where id=v_catalog_item;
  assert not exists(select 1 from public.item_providers where item_id=v_catalog_item)
     and not exists(select 1 from public.item_places where item_id=v_catalog_item),
    'Item deletion removes its place and provider mappings';
  set constraints all deferred;

  begin
    update public.providers
    set place_id=(select place_id from public.providers where id=v_busan_provider)
    where id=v_gangnam_provider;
    assert false,'Provider identity must be immutable';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PROVIDER_IDENTITY_IMMUTABLE','Provider cannot move to another place';
  end;

  insert into public.places(id,name,road_address,place_provider,provider_place_id)
  values (v_spare_place,'빈 장소','서울 종로구 빈로 1','pftest','spare-1');
  begin
    insert into public.item_places(item_id,category_id,place_id)
    values (v_online_item,v_cat_a,v_spare_place);
    assert false,'Online provider item cannot gain a place mapping';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_PROVIDER_MISMATCH','Place mapping for a foreign provider is rejected';
  end;

  begin
    set constraints all immediate;
    delete from public.item_places where item_id=v_gangnam_item;
    assert false,'Offline provider item without its place must fail';
  exception when check_violation then
    assert sqlerrm='ITEM_PROVIDER_PLACE_MISMATCH','Offline item must keep its place mapping';
  end;
  set constraints all deferred;

  begin
    set constraints all immediate;
    update public.item_providers set provider_id=v_busan_provider where item_id=v_gangnam_b_item;
    assert false,'Offline item cannot move to a provider at another place';
  exception when check_violation then
    assert sqlerrm='ITEM_PROVIDER_PLACE_MISMATCH','Provider and place must agree';
  end;
  set constraints all deferred;

  begin
    set constraints all immediate;
    delete from public.item_providers where item_id=v_gangnam_item;
    assert false,'Place-backed item cannot drop its provider';
  exception when check_violation then
    assert sqlerrm='ITEM_PROVIDER_REQUIRED','Place-backed item requires a provider';
  end;
  set constraints all deferred;

  begin
    insert into public.online_stores(store_type,host,store_key,official_url)
    values ('official_site','other.example','site:different.example','https://other.example');
    assert false,'Official store key must match its host';
  exception when check_violation then null;
  end;

  set constraints all immediate;
  set constraints all deferred;

  insert into pf_ids values
    ('online_provider',v_online),('online_pending',v_online2),('online_store',v_store),
    ('online_store_pending',v_store2),('brand',v_brand);
end;
$flow$;
$test$, 'Online providers, brands, pick gating and provider invariants');

-- 4. Read access -----------------------------------------------------------
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_admin uuid := (select id from pf_ids where key='admin');
  v_user2 uuid := (select id from pf_ids where key='user2');
  v_legacy_item uuid := (select id from pf_ids where key='legacy_item');
  v_legacy_provider uuid := (select id from pf_ids where key='legacy_provider');
  v_online uuid := (select id from pf_ids where key='online_provider');
  v_online_pending uuid := (select id from pf_ids where key='online_pending');
  v_store uuid := (select id from pf_ids where key='online_store');
  v_store_pending uuid := (select id from pf_ids where key='online_store_pending');
  v_hidden_item uuid := (select id from pf_ids where key='hidden_item');
  v_hidden_place uuid := (select id from pf_ids where key='hidden_place');
  v_brand uuid := (select id from pf_ids where key='brand');
  v_count bigint;
begin
  assert not has_table_privilege('anon','public.providers','insert')
     and not has_table_privilege('authenticated','public.providers','insert')
     and not has_table_privilege('authenticated','public.providers','update')
     and not has_table_privilege('authenticated','public.online_stores','insert')
     and not has_table_privilege('authenticated','public.item_providers','insert'),
    'Clients cannot write providers or online stores directly';
  assert has_table_privilege('anon','public.providers','select')
     and has_table_privilege('anon','public.online_stores','select'),
    'Guests may read public provider profiles';
  assert not has_function_privilege('authenticated','private.backfill_place_providers()','execute'),
    'Backfill is not callable by clients';

  update public.brands set is_active=false where id=v_brand;

  set local role anon;
  -- Existing share links: the item row and its provider stay readable.
  assert exists(select 1 from public.items where id=v_legacy_item),
    'Existing /item/{id} target is still publicly readable';
  assert exists(
    select 1 from public.item_providers ipr join public.providers p on p.id=ipr.provider_id
    where ipr.item_id=v_legacy_item and p.id=v_legacy_provider
  ), 'Guests can resolve an item to its active provider';
  assert exists(select 1 from public.providers where id=v_online),
    'Active online provider is public';
  assert exists(select 1 from public.online_stores where id=v_store),
    'Store of an active provider is public';
  assert not exists(select 1 from public.providers where id=v_online_pending),
    'Pending provider is not public';
  assert not exists(select 1 from public.online_stores where id=v_store_pending),
    'Store of a pending provider is not public';
  assert not exists(select 1 from public.item_providers where item_id=v_hidden_item)
     and not exists(select 1 from public.providers where place_id=v_hidden_place),
    'Active provider at an invisible place and its mapping are not public';
  assert exists(select 1 from public.providers where brand_id=v_brand),
    'Inactive brand hides only the brand, not its providers';
  assert not exists(select 1 from public.brands where id=v_brand),
    'Inactive brand itself stays private';
  reset role;

  perform set_config('request.jwt.claim.sub',v_user2::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert not exists(select 1 from public.providers where id=v_online_pending),
    'Signed-in non-admins cannot see pending providers';
  reset role;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  assert exists(select 1 from public.providers where id=v_online_pending)
     and exists(select 1 from public.online_stores where id=v_store_pending),
    'MFA admins can review pending providers and stores';
  reset role;
end;
$flow$;
$test$, 'Provider read access follows provider status and place visibility');

select * from finish();
rollback;
