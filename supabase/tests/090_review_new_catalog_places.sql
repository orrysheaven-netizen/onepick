begin;

create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_admin uuid := gen_random_uuid();
  v_alice uuid := gen_random_uuid();
  v_bob uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_gangnam uuid := gen_random_uuid();
  v_mapo uuid := gen_random_uuid();
  v_item public.items%rowtype;
  v_again public.items%rowtype;
  v_mapo_item public.items%rowtype;
  v_moved public.items%rowtype;
  v_pick public.picks%rowtype;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[v_admin,v_alice,v_bob]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'rc_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[v_admin,v_alice,v_bob]) id;
  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_cat_a,'리뷰 맛집 A','review-place-a-'||substr(replace(v_cat_a::text,'-',''),1,8),'open',true,true),
    (v_cat_b,'리뷰 맛집 B','review-place-b-'||substr(replace(v_cat_b::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (v_cat_a,'internal',true,true,'Review fixture A'),
    (v_cat_b,'internal',true,true,'Review fixture B');
  -- Two branches with the same name.
  insert into public.place_catalog(
    id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,region_1,region_2,provider_category,business_status,source_updated_at
  ) values
    (v_gangnam,'reviewplace','gangnam','원픽식당','원픽식당','강남점','서울 강남구 원픽로 1','서울','강남구','한식','open',now()),
    (v_mapo,'reviewplace','mapo','원픽식당','원픽식당','마포점','서울 마포구 원픽로 2','서울','마포구','한식','open',now());

  -- A new place is a pending request by the selecting user.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);

  v_item := public.select_place_catalog_item(v_cat_a,v_gangnam);
  assert v_item.status='pending' and v_item.created_by=v_alice
     and v_item.external_source='onepick_place',
    'Selecting a new catalog place creates a pending request';
  assert not exists(select 1 from public.picks where item_id=v_item.id),
    'No Pick exists before review';

  v_again := public.select_place_catalog_item(v_cat_a,v_gangnam);
  assert v_again.id=v_item.id and v_again.status='pending',
    'Reselecting your own pending place returns the same request';

  perform public.set_pending_item_pick_review(v_item.id,'강남점이 최고');

  begin
    perform public.change_pick(v_cat_a,v_item.id,'검수 전 선택');
    assert false,'A pending place cannot be picked directly';
  exception when sqlstate 'P0001' then
    null;
  end;

  -- Someone else's pending request blocks a duplicate request.
  perform set_config('request.jwt.claim.sub',v_bob::text,true);
  begin
    perform public.select_place_catalog_item(v_cat_a,v_gangnam);
    assert false,'Another user cannot open a second request for the same place';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_ALREADY_PENDING','Pending place reports ITEM_ALREADY_PENDING';
  end;

  -- The same name at another branch is a separate request.
  v_mapo_item := public.select_place_catalog_item(v_cat_a,v_mapo);
  assert v_mapo_item.id<>v_item.id and v_mapo_item.status='pending',
    'Another branch with the same name is its own request';

  -- Alice also requests the 강남 place in category B.
  perform set_config('request.jwt.claim.sub',v_alice::text,true);
  v_moved := public.select_place_catalog_item(v_cat_b,v_gangnam);
  assert v_moved.status='pending','Same place in another category is a separate request';

  -- Admin review.
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);

  v_item := public.admin_review_pending_item(v_item.id,'active');
  assert v_item.status='active' and v_item.name='원픽식당',
    'Approval activates the place item and keeps its catalog name';

  v_mapo_item := public.admin_review_pending_item(v_mapo_item.id,'active');
  assert v_mapo_item.status='active',
    'A same-name branch is approved without ITEM_DUPLICATE';

  begin
    perform public.admin_review_pending_item(v_moved.id,'active',v_cat_a);
    assert false,'A place item cannot be approved into another category';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PLACE_ITEM_CATEGORY_LOCKED','Category change reports PLACE_ITEM_CATEGORY_LOCKED';
  end;

  begin
    perform public.admin_merge_pending_item(v_moved.id,v_mapo_item.id);
    assert false,'A place request cannot be merged away from its place';
  exception when sqlstate 'P0001' then
    assert sqlerrm='SOURCE_PROVIDER_ITEM_NOT_MERGEABLE','Place requests stay unmergeable';
  end;

  perform public.admin_review_pending_item(v_moved.id,'rejected',null,'카테고리가 맞지 않아요');
  reset role;

  select * into v_pick
  from public.picks
  where user_id=v_alice and category_id=v_cat_a and status='active';
  assert v_pick.item_id=v_item.id and v_pick.one_line_review='강남점이 최고',
    'Approval makes the saved review the requester''s Pick';

  -- After review, selection works like any active item.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  v_again := public.select_place_catalog_item(v_cat_a,v_gangnam);
  assert v_again.id=v_item.id and v_again.status='active',
    'An approved place is returned for direct picking';

  begin
    perform public.select_place_catalog_item(v_cat_b,v_gangnam);
    assert false,'A rejected place request stays closed';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_NOT_ELIGIBLE','Rejected place reports ITEM_NOT_ELIGIBLE';
  end;

  v_pick := public.change_pick(v_cat_a,v_again.id,'나도 여기');
  assert v_pick.status='active' and v_pick.item_id=v_item.id,
    'The approved place is pickable';
  reset role;
end;
$flow$;
$test$, 'New catalog places go through admin review before they can be picked');

select * from finish();
rollback;
