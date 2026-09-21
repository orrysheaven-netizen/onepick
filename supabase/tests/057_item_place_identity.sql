-- Physical restaurant branches use provider identity rather than item name for
-- deduplication. Same-name branches must remain separate even in categories
-- whose ordinary internal catalog forbids duplicate normalized names.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_alice constant uuid := 'f8900000-0000-4000-8000-000000000001';
  v_bob constant uuid := 'f8900000-0000-4000-8000-000000000002';
  v_category constant uuid := 'f8a00000-0000-4000-8000-000000000001';
  v_other_category constant uuid := 'f8a00000-0000-4000-8000-000000000002';
  v_first public.items%rowtype;
  v_retry public.items%rowtype;
  v_same_identity public.items%rowtype;
  v_second_branch public.items%rowtype;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
    (v_alice,'authenticated','authenticated','place-alice@example.invalid','',now(),now()),
    (v_bob,'authenticated','authenticated','place-bob@example.invalid','',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_alice,'place_alice',true),(v_bob,'place_bob',true);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_category,'순대국 QA','qa-sundaeguk-place','open',true,true),
    (v_other_category,'곰탕 QA','qa-gomtang-place','open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled) values
    (v_category,'internal',true),(v_other_category,'internal',true);

  assert not has_table_privilege('authenticated','public.item_places','insert'),
    'Clients cannot bypass place validation with direct writes';
  assert not has_table_privilege('authenticated','public.item_channels','insert'),
    'Clients cannot bypass channel validation with direct writes';
  assert not has_function_privilege(
    'anon',
    'public.submit_place_item(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text)',
    'execute'
  ), 'Anonymous place submission is denied';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_alice::text,true);

  v_first := public.submit_place_item(
    v_category,
    '할머니순대국',
    'fixture-map',
    'seoul-001',
    '서울특별시 강남구 테스트로 1',
    '강남점',
    null,
    '서울특별시',
    '강남구',
    37.5001,
    127.0301,
    'https://maps.example.invalid/seoul-001'
  );

  assert v_first.status='pending' and v_first.created_by=v_alice,
    'A new place starts as the submitter pending item';
  assert (
    select place_provider='fixture-map'
      and provider_place_id='seoul-001'
      and branch_name='강남점'
    from public.item_places where item_id=v_first.id
  ), 'Stable provider identity is stored beside the item';
  assert (
    select channel='offline' and is_primary
    from public.item_channels where item_id=v_first.id
  ), 'A place submission creates the primary offline channel';

  v_retry := public.submit_place_item(
    v_category,
    '이름을 바꿔도 같은 장소',
    'FIXTURE-MAP',
    'seoul-001',
    '서울특별시 강남구 다른 표기 99'
  );
  assert v_retry.id=v_first.id,
    'Provider identity, not the submitted display name/address, controls retry dedupe';

  reset role;
  update public.items set status='active' where id=v_first.id;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_bob::text,true);

  v_same_identity := public.submit_place_item(
    v_category,
    '할머니순대국 강남점',
    'fixture-map',
    'seoul-001',
    '서울특별시 강남구 테스트로 1'
  );
  assert v_same_identity.id=v_first.id,
    'An active place is shared across users by stable provider identity';

  v_second_branch := public.submit_place_item(
    v_category,
    '할머니순대국',
    'fixture-map',
    'busan-001',
    '부산광역시 부산진구 테스트로 2',
    '서면점',
    null,
    '부산광역시',
    '부산진구',
    35.1579,
    129.0594,
    'https://maps.example.invalid/busan-001'
  );

  assert v_second_branch.id<>v_first.id,
    'Same-name places with different provider ids are different items';
  assert v_second_branch.normalized_name=v_first.normalized_name,
    'The regression proves duplicate normalized names can coexist for identified places';
  assert (
    select count(*)=2
    from public.items
    where category_id=v_category
      and normalized_name=v_first.normalized_name
      and status in ('active','pending')
  ), 'The internal-catalog name guard exempts provider-identified place items only';

  begin
    perform public.submit_place_item(
      v_other_category,
      '할머니순대국',
      'fixture-map',
      'seoul-001',
      '서울특별시 강남구 테스트로 1'
    );
    assert false, 'The same provider identity cannot silently move categories';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PLACE_CATEGORY_MISMATCH', 'Expected place/category mismatch rejection';
  end;

  reset role;
end;
$flow$;
$test$, 'Provider identity keeps same-name restaurant branches distinct and safely reusable');

select * from finish();
rollback;
