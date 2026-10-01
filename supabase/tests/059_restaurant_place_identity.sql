begin;

create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_place_item_a public.items%rowtype;
  v_place_item_b public.items%rowtype;
  v_place_item_a_repeat public.items%rowtype;
  v_same_place_other_category public.items%rowtype;
  v_generic_item uuid := gen_random_uuid();
  v_broken_item uuid := gen_random_uuid();
  v_place_a uuid;
  v_place_a_again uuid;
  v_pick public.picks%rowtype;
  v_count bigint;
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now());

  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'place_admin_'||substr(replace(v_admin::text,'-',''),1,8),true),
    (v_user,'place_user_'||substr(replace(v_user::text,'-',''),1,8),true);

  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_cat_a,'맛집 장소 A','place-a-'||substr(replace(v_cat_a::text,'-',''),1,8),'open',true,true),
    (v_cat_b,'맛집 장소 B','place-b-'||substr(replace(v_cat_b::text,'-',''),1,8),'open',true,true);

  insert into public.category_catalog_sources(category_id,mode,is_enabled,notes) values
    (v_cat_a,'internal',true,'Restaurant place identity fixture'),
    (v_cat_b,'internal',true,'Restaurant place identity fixture');

  -- This test exercises a non-photo contract. The product now requires photos for
-- new/replacement Picks, so give eligible fixtures a test-only external image.
update public.items
set image_source_url='https://example.invalid/test-photo.jpg'
where status in ('active','discontinued')
  and image_path is null and thumbnail_path is null and image_source_url is null;

perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;

  v_place_item_a := public.admin_upsert_place_item(
    v_cat_a,'같은상호','강남점','testmap','place-1',
    '서울 강남구 테스트로 1','서울 강남구 테스트로 1','서울','강남구',
    37.500000,127.000000,'https://maps.example/place-1'
  );

  v_place_item_b := public.admin_upsert_place_item(
    v_cat_a,'같은상호','부산점','testmap','place-2',
    '부산 해운대구 테스트로 2','부산 해운대구 테스트로 2','부산','해운대구',
    35.100000,129.000000,'https://maps.example/place-2'
  );

  assert v_place_item_a.id<>v_place_item_b.id,
    'Same name with different provider place ids must stay separate';
  assert v_place_item_a.normalized_name=v_place_item_b.normalized_name,
    'Place-backed items may intentionally share normalized names';

  v_place_item_a_repeat := public.admin_upsert_place_item(
    v_cat_a,'같은상호','강남점','testmap','place-1',
    '서울 강남구 테스트로 1','서울 강남구 테스트로 1','서울','강남구',
    37.500000,127.000000,'https://maps.example/place-1'
  );

  assert v_place_item_a_repeat.id=v_place_item_a.id,
    'Same canonical place in the same category must reuse the item';

  select place_id into v_place_a
  from public.item_places where item_id=v_place_item_a.id;

  v_same_place_other_category := public.admin_upsert_place_item(
    v_cat_b,'같은상호','강남점','testmap','place-1',
    '서울 강남구 테스트로 1','서울 강남구 테스트로 1','서울','강남구',
    37.500000,127.000000,'https://maps.example/place-1'
  );

  select place_id into v_place_a_again
  from public.item_places where item_id=v_same_place_other_category.id;

  assert v_same_place_other_category.id<>v_place_item_a.id,
    'One physical place may be a candidate in multiple food categories';
  assert v_place_a_again=v_place_a,
    'Multiple category items must resolve to the same canonical place';

  reset role;

  -- A normal online/product-style internal item with the same display name
  -- remains independent from place-backed items.
  insert into public.items(
    id,category_id,name,normalized_name,status
  ) values (
    v_generic_item,v_cat_a,'같은상호','같은상호','active'
  );
  assert exists(select 1 from public.items where id=v_generic_item),
    'Generic item name dedupe must ignore place-backed items';

  -- Ordinary internal items still dedupe against each other.
  begin
    insert into public.items(category_id,name,normalized_name,status)
    values(v_cat_a,'같은상호','같은상호','active');
    assert false,'A second generic internal item with the same name must fail';
  exception when unique_violation then
    null;
  end;

  -- An offline channel without canonical place identity is never pickable.
  insert into public.items(
    id,category_id,name,normalized_name,status,external_source,external_id
  ) values (
    v_broken_item,v_cat_a,'Broken Place','brokenplace','active',
    'onepick_place',gen_random_uuid()::text||':'||v_cat_a::text
  );
  insert into public.item_channels(item_id,channel,is_primary)
  values(v_broken_item,'offline',true);

  update public.items
  set image_source_url='https://example.invalid/place-photo.jpg'
  where id in (v_place_item_a.id,v_place_item_b.id);

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;

  begin
    perform public.change_pick(v_cat_a,v_broken_item,'장소 식별자가 없음');
    assert false,'Offline item without canonical place identity must not become a pick';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PLACE_IDENTITY_REQUIRED',
      'Expected PLACE_IDENTITY_REQUIRED for incomplete offline item';
  end;

  v_pick := public.change_pick(v_cat_a,v_place_item_a.id,'강남점이 내 원픽');
  assert v_pick.status='active','First place pick becomes active';

  v_pick := public.change_pick(v_cat_a,v_place_item_b.id,'부산점으로 원픽 변경');
  assert v_pick.status='active' and v_pick.item_id=v_place_item_b.id,
    'Changing place in one category activates the new pick';

  select count(*) into v_count
  from public.picks p
  where p.user_id=v_user
    and p.category_id=v_cat_a
    and p.status='active';
  assert v_count=1,'Exactly one current pick remains per category';

  select count(*) into v_count
  from public.picks p
  where p.user_id=v_user
    and p.category_id=v_cat_a
    and p.status='replaced';
  assert v_count=1,'Previous place pick is replaced, not kept active';

  reset role;

  assert has_table_privilege('anon','public.places','select'),
    'Guests can read visible canonical places';
  assert has_table_privilege('authenticated','public.item_places','select'),
    'Signed-in users can read approved item-place mappings';
  assert not has_table_privilege('authenticated','public.places','insert'),
    'Ordinary authenticated users cannot directly create canonical places';
  assert not has_table_privilege('authenticated','public.item_places','insert'),
    'Ordinary authenticated users cannot assert item-place mappings';

  set local role anon;
  select count(*) into v_count
  from public.places
  where place_provider='testmap';
  assert v_count=2,
    'Public reads expose the two visible physical places, not category duplicates';
  reset role;
end;
$flow$;
$test$, 'Canonical restaurant places, multi-category mapping, name isolation and pick gating');

select * from finish();
rollback;
