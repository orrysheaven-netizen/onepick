begin;

create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_user uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_catalog uuid := gen_random_uuid();
  v_food uuid;
  v_item_a uuid;
  v_item_a_repeat uuid;
  v_item_b uuid;
  v_place_a uuid;
  v_place_b uuid;
  v_created boolean;
  v_pick public.picks%rowtype;
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
  v_count bigint;
begin
  select id into v_food from public.categories where slug='food';
  assert v_food is not null,'food root must exist';

  insert into auth.users(id,aud,role,created_at,updated_at)
  values(v_user,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
  values(v_user,'place_select_'||v_suffix,true);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
  values(v_group,v_food,'장소 선택 테스트 분류','place-select-group-'||v_suffix,'open',true,false,900);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
  values
    (v_cat_a,v_group,'장소 선택 A','place-select-a-'||v_suffix,'open',true,true,1),
    (v_cat_b,v_group,'장소 선택 B','place-select-b-'||v_suffix,'open',true,true,2);

  insert into public.place_catalog(
    id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,address,region_1,region_2,latitude,longitude,
    provider_category,business_status,source_updated_at
  ) values (
    v_catalog,'sbiz','selection-'||v_suffix,'테스트식당','테스트식당','강남점',
    '서울 강남구 테스트로 1','서울 강남구 테스트동 1','서울','강남구',
    37.500000,127.000000,'한식','open',now()
  );

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;

  select s.item_id,s.created into v_item_a,v_created
  from public.select_place_catalog_item(v_catalog,v_cat_a) s;
  assert v_item_a is not null and v_created,
    'first selection creates a category item';

  select s.item_id,s.created into v_item_a_repeat,v_created
  from public.select_place_catalog_item(v_catalog,v_cat_a) s;
  assert v_item_a_repeat=v_item_a and not v_created,
    'repeat selection reuses the same category item';

  select s.item_id,s.created into v_item_b,v_created
  from public.select_place_catalog_item(v_catalog,v_cat_b) s;
  assert v_item_b<>v_item_a and v_created,
    'same physical place can create a distinct item for another food leaf';

  select place_id into v_place_a from public.item_places where item_id=v_item_a;
  select place_id into v_place_b from public.item_places where item_id=v_item_b;
  assert v_place_a=v_place_b,
    'category items share one canonical place identity';

  v_pick := public.change_pick(v_cat_a,v_item_a,'여기가 내 원픽');
  assert v_pick.status='active' and v_pick.item_id=v_item_a,
    'selected place item continues through the existing pick flow';

  select count(*) into v_count
  from public.places
  where place_provider='sbiz' and provider_place_id='selection-'||v_suffix;
  assert v_count=1,'selection creates only one canonical place';

  reset role;

  assert not has_function_privilege('anon','public.select_place_catalog_item(uuid,uuid)','execute'),
    'anonymous callers cannot canonicalize provider places';
  assert has_function_privilege('authenticated','public.select_place_catalog_item(uuid,uuid)','execute'),
    'authenticated callers can select a trusted open catalog place';
end;
$flow$;
$test$, 'Place catalog selection reuses canonical identity and existing Pick flow');

select * from finish();
rollback;
