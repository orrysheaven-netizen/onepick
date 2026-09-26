begin;

create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_user uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_cat_disabled uuid := gen_random_uuid();
  v_catalog uuid := gen_random_uuid();
  v_closed uuid := gen_random_uuid();
  v_item_a public.items%rowtype;
  v_item_a_repeat public.items%rowtype;
  v_item_b public.items%rowtype;
  v_place_a uuid;
  v_place_b uuid;
  v_count bigint;
  v_pick public.picks%rowtype;
begin
  assert exists(
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='category_catalog_sources'
      and column_name='place_catalog_enabled'
  ), 'Category catalog source has a place-catalog capability flag';

  assert has_function_privilege('anon','public.category_uses_place_catalog(uuid)','execute'),
    'Guests may inspect whether a category uses the public place catalog';
  assert has_function_privilege('anon','public.search_place_catalog(uuid,text,integer)','execute'),
    'Guests may search public open place rows';
  assert not has_function_privilege('anon','public.select_place_catalog_item(uuid,uuid)','execute'),
    'Guests cannot materialize a canonical place-backed item';
  assert has_function_privilege('authenticated','public.select_place_catalog_item(uuid,uuid)','execute'),
    'Signed-in users may select a trusted catalog place';

  insert into auth.users(id,aud,role,created_at,updated_at)
  values(v_user,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
  values(v_user,'ps_'||substr(replace(v_user::text,'-',''),1,8),true);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_cat_a,'맛집 검색 A','place-search-a-'||substr(replace(v_cat_a::text,'-',''),1,8),'open',true,true),
    (v_cat_b,'맛집 검색 B','place-search-b-'||substr(replace(v_cat_b::text,'-',''),1,8),'open',true,true),
    (v_cat_disabled,'일반 상품','place-search-off-'||substr(replace(v_cat_disabled::text,'-',''),1,8),'open',true,true);

  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (v_cat_a,'internal',true,true,'Place search fixture A'),
    (v_cat_b,'internal',true,true,'Place search fixture B'),
    (v_cat_disabled,'internal',true,false,'Ordinary item fixture');

  insert into public.place_catalog(
    id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,address,region_1,region_2,latitude,longitude,
    provider_category,business_status,source_updated_at
  ) values (
    v_catalog,'testplace','open-1','원픽식당','강남원픽식당','강남점',
    '서울 강남구 원픽로 1','서울 강남구 원픽동 1','서울','강남구',37.500000,127.000000,
    '한식','open',now()
  );

  update public.place_catalog set normalized_name='원픽식당' where id=v_catalog;

  insert into public.place_catalog(
    id,place_provider,provider_place_id,name,normalized_name,road_address,
    region_1,region_2,business_status,source_updated_at,closed_at
  ) values (
    v_closed,'testplace','closed-1','폐업원픽','폐업원픽','서울 강남구 폐업로 1',
    '서울','강남구','closed',now(),now()
  );

  set local role anon;
  assert public.category_uses_place_catalog(v_cat_a),
    'Enabled restaurant leaf advertises place search';
  assert not public.category_uses_place_catalog(v_cat_disabled),
    'Ordinary internal item category does not become a place category';
  select count(*) into v_count from public.search_place_catalog(v_cat_a,'원픽식당',20);
  assert v_count=1,'Open catalog row is searchable in an enabled category';
  select count(*) into v_count from public.search_place_catalog(v_cat_disabled,'원픽식당',20);
  assert v_count=0,'Disabled category cannot query place catalog rows';
  select count(*) into v_count from public.search_place_catalog(v_cat_a,'폐업원픽',20);
  assert v_count=0,'Closed businesses stay hidden from public place search';
  reset role;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;

  v_item_a := public.select_place_catalog_item(v_cat_a,v_catalog);
  assert v_item_a.category_id=v_cat_a and v_item_a.external_source='onepick_place',
    'Selecting an open catalog row creates a place-backed item in the chosen category';
  assert v_item_a.status='pending' and v_item_a.created_by=v_user,
    'A newly selected place is a request waiting for admin review';

  v_item_a_repeat := public.select_place_catalog_item(v_cat_a,v_catalog);
  assert v_item_a_repeat.id=v_item_a.id,
    'Selecting the same place in the same category reuses the existing item';

  -- Stand-in for admin approval (covered in 093_review_new_catalog_places);
  -- a pending item's place rows are not readable by other users.
  reset role;
  update public.items set status='active' where id=v_item_a.id;
  set local role authenticated;

  select place_id into v_place_a from public.item_places where item_id=v_item_a.id;
  assert v_place_a is not null,'Selected item has canonical place identity';
  assert exists(
    select 1 from public.item_channels
    where item_id=v_item_a.id and channel='offline' and is_primary
  ), 'Selected place item has a primary offline channel';

  v_item_b := public.select_place_catalog_item(v_cat_b,v_catalog);
  reset role;
  update public.items set status='active' where id=v_item_b.id;
  set local role authenticated;
  select place_id into v_place_b from public.item_places where item_id=v_item_b.id;
  assert v_item_b.id<>v_item_a.id and v_place_b=v_place_a,
    'One physical place can become different category items without duplicating canonical identity';

  begin
    perform public.select_place_catalog_item(v_cat_disabled,v_catalog);
    assert false,'Ordinary item categories must not materialize a place item';
  exception when sqlstate 'P0001' then
    assert sqlerrm='CATEGORY_NOT_PICKABLE','Disabled place capability rejects selection';
  end;

  begin
    perform public.select_place_catalog_item(v_cat_a,v_closed);
    assert false,'Closed catalog rows must not materialize a place item';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_NOT_FOUND','Closed place selection is rejected';
  end;

  v_pick := public.change_pick(v_cat_a,v_item_a.id,'여기가 내 원픽');
  assert v_pick.status='active' and v_pick.item_id=v_item_a.id,
    'The existing Pick flow accepts the canonical place-backed item';

  reset role;

  update public.places set is_visible=false where id=v_place_a;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  set local role authenticated;
  begin
    perform public.select_place_catalog_item(v_cat_a,v_catalog);
    assert false,'A hidden canonical place must not be silently reactivated by user selection';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_NOT_ELIGIBLE','Hidden place remains moderated';
  end;
  reset role;

  assert (select count(*) from public.places where place_provider='testplace' and provider_place_id='open-1')=1,
    'Repeated user selection never duplicates the provider identity';
end;
$flow$;
$test$, 'Trusted place catalog search materializes canonical place items and reuses the existing Pick flow');

select * from finish();
rollback;
