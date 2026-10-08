begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  admin uuid := gen_random_uuid(); alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  carol uuid := gen_random_uuid(); dave uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); brand uuid := gen_random_uuid();
  gangnam uuid := gen_random_uuid(); mapo uuid := gen_random_uuid(); nopick uuid := gen_random_uuid();
  g_item uuid; m_item uuid; n_item uuid; b_item uuid; u_item uuid; u_place uuid; u_catalog uuid;
  p_g uuid; p_m uuid; p_b uuid; p_u uuid;
  prov_g uuid; prov_m uuid; prov_n uuid;
  res jsonb; prof jsonb; row_json jsonb; got uuid[]; n integer; raised boolean;
  v_item public.items%rowtype;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[admin,alice,bob,carol,dave]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'bsc_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[admin,alice,bob,carol,dave]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'브랜드 국수','bsc-noodles-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (menu,grp,'브랜드 평양냉면','bsc-naengmyeon-'||substr(replace(menu::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (menu,'internal',true,true,'brand scope fixture');
  insert into public.brands(id,name,normalized_name) values (brand,'브랜드을밀대','bsc-'||substr(replace(brand::text,'-',''),1,8));
  insert into public.place_catalog(id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,region_1,region_2,provider_category,business_status,source_updated_at)
  values
    (gangnam,'bsctest','bsc-1','브랜드을밀대',private.normalize_place_name('브랜드을밀대'),'강남점','서울 강남구 브랜드로 1','서울','강남구','국수','open',now()),
    (mapo,   'bsctest','bsc-2','브랜드을밀대',private.normalize_place_name('브랜드을밀대'),'마포점','서울 마포구 브랜드로 2','서울','마포구','국수','open',now()),
    (nopick, 'bsctest','bsc-3','브랜드을밀대',private.normalize_place_name('브랜드을밀대'),'한산점','서울 용산구 브랜드로 3','서울','용산구','국수','open',now());
  insert into storage.objects(bucket_id,name,owner_id,metadata)
  select 'item-photos', u::text||'/'||f.name, u::text, jsonb_build_object('mimetype','image/jpeg','size',f.size)
  from unnest(array[alice,bob,carol,dave]) u cross join (values ('full.jpg',1024),('thumb.jpg',100)) f(name,size);

  -- Two branches picked (alice → 강남점, bob → 마포점), one branch approved but unpicked.
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  res := public.register_item_pick(menu,'offline','강남점이 최고', p_catalog_id => gangnam,
    p_image_path => alice::text||'/full.jpg', p_thumbnail_path => alice::text||'/thumb.jpg');
  g_item := (res->>'item_id')::uuid; p_g := (res->>'pick_id')::uuid;
  reset role;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  res := public.register_item_pick(menu,'offline','마포점이 최고', p_catalog_id => mapo,
    p_image_path => bob::text||'/full.jpg', p_thumbnail_path => bob::text||'/thumb.jpg');
  m_item := (res->>'item_id')::uuid; p_m := (res->>'pick_id')::uuid;
  v_item := public.select_place_catalog_item(menu, nopick);
  n_item := v_item.id;
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(g_item,'active');
  perform public.admin_review_pending_item(m_item,'active');
  perform public.admin_review_pending_item(n_item,'active');
  select ip.provider_id into prov_g from public.item_providers ip where ip.item_id=g_item;
  select ip.provider_id into prov_m from public.item_providers ip where ip.item_id=m_item;
  select ip.provider_id into prov_n from public.item_providers ip where ip.item_id=n_item;
  perform public.admin_set_provider_brand(prov_g, brand);
  perform public.admin_set_provider_brand(prov_m, brand);
  perform public.admin_set_provider_brand(prov_n, brand);
  reset role;
  assert (select status='active' from public.picks where id=p_g) and (select status='active' from public.picks where id=p_m), 'Branch Picks are published';

  -- ------------------------------------------------------------ brand-wide product
  perform set_config('request.jwt.claim.sub',carol::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.stage_brand_item(menu, gen_random_uuid());
  exception when others then raised := sqlerrm = 'BRAND_NOT_FOUND'; end;
  assert raised, 'Unknown brands are refused';
  v_item := public.stage_brand_item(menu, brand);
  b_item := v_item.id;
  assert v_item.status='pending' and v_item.external_source='onepick_brand' and v_item.brand_id=brand, 'The brand-wide product is the caller''s pending request';
  assert (select count(*) from public.item_brand_scopes where item_id=b_item) = 1, 'The requester reads the brand scope of their request';
  assert (public.stage_brand_item(menu, brand)).id = b_item, 'Staging again returns the same request';
  res := public.register_item_pick(menu,'offline','어느 지점이든 좋아', p_item_id => b_item,
    p_image_path => carol::text||'/full.jpg', p_thumbnail_path => carol::text||'/thumb.jpg');
  p_b := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean = false, 'The brand-wide Pick waits for approval';
  reset role;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.stage_brand_item(menu, brand);
  exception when others then raised := sqlerrm = 'ITEM_ALREADY_PENDING'; end;
  assert raised, 'Another member cannot take over a pending brand-wide request';
  assert (select count(*) from public.item_brand_scopes where item_id=b_item) = 0, 'Others do not see the pending brand scope';
  reset role;
  -- Before approval the brand profile shows no brand-wide section.
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  prof := public.brand_profile(brand);
  assert prof->'brand_wide' = '[]'::jsonb and (prof->>'branch_count')::int = 2, 'Brand profile: no brand-wide products yet, two picked branches: '||prof::text;
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.admin_merge_pending_item(b_item, g_item);
  exception when others then raised := sqlerrm = 'SOURCE_PROVIDER_ITEM_NOT_MERGEABLE'; end;
  assert raised, 'A brand-wide request is never merged into a branch';
  perform public.admin_review_pending_item(b_item,'active');
  reset role;
  assert (select status='active' and name='브랜드을밀대' from public.items where id=b_item), 'Approval keeps the brand name although branches share it (no ITEM_DUPLICATE)';
  assert (select status='active' from public.picks where id=p_b), 'Approval publishes the brand-wide Pick (the brand gate accepts it)';
  assert (select count(*) from public.picks where user_id=carol and item_id in (g_item,m_item)) = 0, 'A brand-wide Pick is not a Pick on any branch';

  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  prof := public.brand_profile(brand);
  assert jsonb_array_length(prof->'brand_wide') = 1 and (prof->'brand_wide'->0->>'item_id')::uuid = b_item
    and (prof->'brand_wide'->0->>'pick_count')::int = 1 and (prof->>'branch_count')::int = 2
    and (prof->'brand'->>'name') = '브랜드을밀대',
    'Brand profile separates the brand-wide product from the branches and never sums them: '||prof::text;
  assert (select brand_id from public.item_brands(array[b_item])) = brand, 'Card reads resolve the brand of a brand-wide product';
  assert (select count(*) from public.item_brand_scopes where item_id=b_item) = 1, 'Guests read the scope once the product is published';
  select array_agg((r->>'provider_id')::uuid order by ord) into got
    from public.brand_branch_page(brand) with ordinality as t(r, ord);
  assert array_length(got,1) = 2 and prov_g = any(got) and prov_m = any(got) and not (prov_n = any(got)),
    'Only branches with a current Pick are listed (one person is enough): '||coalesce(got::text,'null');
  select r into row_json from public.brand_branch_page(brand) r where (r->>'provider_id')::uuid = prov_g;
  assert (row_json->>'pick_count')::int = 1 and (row_json->>'menu_count')::int = 1 and row_json->>'branch_name' = '강남점'
    and row_json->>'kind' = 'offline_branch' and row_json->>'road_address' = '서울 강남구 브랜드로 1',
    'A branch row carries its own count, menu count and address: '||row_json::text;
  -- Paging one row at a time reaches both.
  select r into row_json from public.brand_branch_page(brand, p_limit => 1) r;
  select array_agg((r->>'provider_id')::uuid order by ord) into got
    from public.brand_branch_page(brand, (row_json->>'pick_count')::bigint, (row_json->>'provider_id')::uuid, 1) with ordinality as t(r, ord);
  assert array_length(got,1) = 1 and got[1] <> (row_json->>'provider_id')::uuid, 'The cursor continues to the next branch';
  raised := false;
  begin
    perform public.brand_branch_page(brand, 1, null);
  exception when sqlstate '22023' then raised := true; end;
  assert raised, 'Half a cursor is rejected';
  assert public.brand_profile(gen_random_uuid()) is null, 'Unknown brands have no profile';
  assert (select count(*) from public.brand_branch_page(gen_random_uuid())) = 0, 'Unknown brands have no branches';
  reset role;

  -- ------------------------------------------------------------ a store the catalog does not know
  perform set_config('request.jwt.claim.sub',dave::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'동네국밥','서울 마포구 동네길 1','https://example.com/map');
  exception when others then raised := sqlerrm = 'LINK_INVALID'; end;
  assert raised, 'The map link must be a Naver map link';
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'동네국밥','서울 마포구 동네길 1',null);
  exception when others then raised := sqlerrm = 'ITEM_LINK_REQUIRED'; end;
  assert raised, 'A new store needs its map link';
  -- Stores without a road address are covered by 111_user_place_without_road_address.sql.
  v_item := public.stage_user_place_item(menu,'동네국밥','서울 마포구 동네길 1','https://naver.me/dongne');
  u_item := v_item.id;
  assert v_item.status='pending' and v_item.external_source='onepick_place', 'A member-submitted store is a pending request';
  assert (public.stage_user_place_item(menu,'동네 국밥','','https://naver.me/dongne')).id = u_item,
    'The same name with the same map link is the same store';
  -- The link can be fixed while it waits; the place follows.
  perform public.revise_item_request(u_item, p_link_url => 'https://naver.me/dongne2');
  res := public.register_item_pick(menu,'offline','동네가 최고', p_item_id => u_item,
    p_image_path => dave::text||'/full.jpg', p_thumbnail_path => dave::text||'/thumb.jpg');
  p_u := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean = false, 'The Pick on a submitted store waits';
  reset role;
  assert not exists (select 1 from public.item_places where item_id=u_item), 'Pending request has no canonical store link';
  assert not exists (select 1 from public.places where map_url='https://naver.me/dongne2'), 'No canonical store is created before approval';
  assert not exists (select 1 from public.place_catalog where name='동네국밥'), 'No catalog row before approval';
  assert (select map_url='https://naver.me/dongne2' from private.user_place_requests where item_id=u_item),
    'The private request carries the revised map link';
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  assert (select count(*) from public.places where map_url='https://naver.me/dongne2') = 0, 'Others see no canonical store before approval';
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'동네국밥','','https://naver.me/dongne2');
  exception when others then raised := sqlerrm = 'ITEM_ALREADY_PENDING'; end;
  assert raised, 'Another member cannot take over the pending store';
  reset role;
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  assert (select count(*) from public.search_store_catalog('동네국밥')) = 0, 'A pending store is not searchable';
  reset role;

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(u_item,'active');
  reset role;
  select ip.place_id into u_place from public.item_places ip where ip.item_id=u_item;
  select pc.id into u_catalog from public.place_catalog pc join public.places p
    on p.place_provider=pc.place_provider and p.provider_place_id=pc.provider_place_id where p.id=u_place;
  assert u_place is not null and u_catalog is not null, 'Approval creates canonical store and catalog';
  assert (select is_visible from public.places where id=u_place), 'Approval publishes the place';
  assert (select business_status='open' from public.place_catalog where id=u_catalog), 'Approval opens the catalog row';
  assert (select status='active' from public.picks where id=p_u), 'Approval activates the Pick on the submitted store';
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into n from public.search_store_catalog('동네국밥') s where s.catalog_id=u_catalog and s.map_url='https://naver.me/dongne2';
  assert n = 1, 'An approved submitted store is searchable with its map link';
  reset role;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert (public.select_place_catalog_item(menu, u_catalog)).id = u_item, 'Selecting the approved store from search reuses the same product';
  reset role;

  assert not has_function_privilege('anon','public.stage_brand_item(uuid,uuid)','execute'), 'Guests cannot stage brand products';
  assert not has_function_privilege('anon','public.stage_user_place_item(uuid,text,text,text,text)','execute'), 'Guests cannot submit stores';
  assert has_function_privilege('anon','public.brand_profile(uuid)','execute') and has_function_privilege('anon','public.brand_branch_page(uuid,bigint,uuid,integer)','execute'), 'Brand profiles are public';
end;
$flow$;
$test$, 'brand scope and submitted stores: brand-wide products are their own scope, brand profile lists picked branches separately, member-submitted stores stay hidden until approval then become searchable');
select * from finish();
rollback;
