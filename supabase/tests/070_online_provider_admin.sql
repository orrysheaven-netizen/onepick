begin;

create extension if not exists pgtap with schema extensions;
select plan(7);
set local plpgsql.check_asserts = on;

create temporary table op_ids(
  key text primary key,
  id uuid not null
) on commit drop;
grant select on op_ids to authenticated;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_brand2 uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now());

  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'op_admin_'||substr(replace(v_admin::text,'-',''),1,8),true),
    (v_user,'op_user_'||substr(replace(v_user::text,'-',''),1,8),true);

  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(
    id,name,slug,status,is_visible,is_pickable
  ) values
    (v_cat_a,'온라인 제공처 테스트 A','op-a-'||substr(replace(v_cat_a::text,'-',''),1,8),'open',true,true),
    (v_cat_b,'온라인 제공처 테스트 B','op-b-'||substr(replace(v_cat_b::text,'-',''),1,8),'open',true,true);

  insert into public.category_catalog_sources(
    category_id,mode,is_enabled,place_catalog_enabled,notes
  ) values
    (v_cat_a,'internal',true,false,'online provider admin test'),
    (v_cat_b,'internal',true,false,'online provider admin test');

  insert into public.brands(id,name,normalized_name) values
    (v_brand,'온라인테스트브랜드','op-brand-'||substr(replace(v_brand::text,'-',''),1,8)),
    (v_brand2,'온라인테스트브랜드2','op-brand2-'||substr(replace(v_brand2::text,'-',''),1,8));

  insert into op_ids values
    ('admin',v_admin),('user',v_user),('cat_a',v_cat_a),('cat_b',v_cat_b),
    ('brand',v_brand),('brand2',v_brand2);
end;
$fixtures$;

select ok(
  not has_table_privilege('authenticated','public.providers','insert')
  and not has_table_privilege('authenticated','public.online_stores','insert')
  and not has_table_privilege('authenticated','public.item_providers','insert'),
  'Clients still cannot write provider tables directly'
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from op_ids where key='admin'),
  true
);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
set local role authenticated;

select throws_ok(
  $$select * from public.admin_upsert_online_provider_item(
      (select id from op_ids where key='cat_a'),
      'A 공식몰','official_site','https://shop-a.example'
    )$$,
  '42501',
  null,
  'Allowlisted AAL1 admin cannot create an online provider'
);

reset role;

set local role anon;
select throws_ok(
  $select * from public.admin_upsert_online_provider_item(
      (select id from op_ids where key='cat_a'),
      '익명 거부 테스트','official_site','https://anon-shop.example'
    )$,
  '42501',
  null,
  'Anonymous users cannot call the online provider admin RPC'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from op_ids where key='user'),
  true
);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $select * from public.admin_upsert_online_provider_item(
      (select id from op_ids where key='cat_a'),
      '일반 사용자 거부 테스트','official_site','https://user-shop.example'
    )$,
  '42501',
  null,
  'Non-admin AAL2 users cannot call the online provider admin RPC'
);
reset role;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_admin uuid := (select id from op_ids where key='admin');
  v_user uuid := (select id from op_ids where key='user');
  v_cat_a uuid := (select id from op_ids where key='cat_a');
  v_cat_b uuid := (select id from op_ids where key='cat_b');
  v_brand uuid := (select id from op_ids where key='brand');
  v_brand2 uuid := (select id from op_ids where key='brand2');
  v_first record;
  v_again record;
  v_second_category record;
  v_platform record;
  v_pick public.picks%rowtype;
  v_audit_before bigint;
  v_audit_after bigint;
begin
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;

  select count(*) into v_audit_before
  from public.admin_audit_logs;

  select * into v_first
  from public.admin_upsert_online_provider_item(
    v_cat_a,
    'A 공식몰',
    'official_site',
    'https://shop-a.example',
    null,
    null,
    v_brand
  );

  assert v_first.provider_id is not null
     and v_first.online_store_id is not null
     and v_first.item_id is not null,
    'AAL2 admin creates store, provider and item';

  assert (
    select store_key from public.online_stores
    where id=v_first.online_store_id
  )='site:shop-a.example',
    'Official site identity is canonicalized from host';

  assert (
    select brand_id from public.providers
    where id=v_first.provider_id
  )=v_brand,
    'Provider owns brand relationship';

  assert (
    select brand_id is null
       and external_source='onepick_provider'
       and external_id=v_first.provider_id::text||':'||v_cat_a::text
    from public.items
    where id=v_first.item_id
  ),
    'Provider item keeps brand null and stable external identity';

  assert exists(
    select 1 from public.item_channels
    where item_id=v_first.item_id
      and channel='online'
      and target_url='https://shop-a.example'
      and is_primary
  ), 'Online item has primary online channel';

  select * into v_again
  from public.admin_upsert_online_provider_item(
    v_cat_a,
    'A 공식몰',
    'official_site',
    'https://shop-a.example'
  );

  assert v_again.provider_id=v_first.provider_id
     and v_again.online_store_id=v_first.online_store_id
     and v_again.item_id=v_first.item_id,
    'Same store/category upsert is idempotent';

  select * into v_second_category
  from public.admin_upsert_online_provider_item(
    v_cat_b,
    'A 공식몰',
    'official_site',
    'https://shop-a.example'
  );

  assert v_second_category.provider_id=v_first.provider_id
     and v_second_category.item_id<>v_first.item_id,
    'Same provider can own one item per fine category';

  select * into v_platform
  from public.admin_upsert_online_provider_item(
    v_cat_a,
    'B 스마트스토어',
    'platform_store',
    'https://smartstore.naver.com/opb',
    'naver_smartstore',
    'naver_smartstore:opb',
    null
  );

  assert (
    select store_type='platform_store'
       and host='smartstore.naver.com'
       and platform='naver_smartstore'
    from public.online_stores
    where id=v_platform.online_store_id
  ), 'Known platform store identity is accepted';

  -- A later failure must roll back an earlier official_url refresh in the same RPC.
  begin
    perform public.admin_upsert_online_provider_item(
      v_cat_a,
      'A 공식몰',
      'official_site',
      'https://shop-a.example/changed',
      null,
      null,
      v_brand2
    );
    assert false,'Conflicting brand upsert must fail';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PROVIDER_BRAND_CONFLICT',
      'Existing provider cannot be silently moved to a different brand';
  end;
  assert (
    select official_url from public.online_stores
    where id=v_first.online_store_id
  )='https://shop-a.example',
    'Failed upsert rolls back the earlier store URL update';

  perform public.admin_set_provider_status(v_first.provider_id,'hidden');
  assert (select status from public.providers where id=v_first.provider_id)='hidden',
    'Status RPC hides provider';

  select * into v_again
  from public.admin_upsert_online_provider_item(
    v_cat_a,
    'A 공식몰',
    'official_site',
    'https://shop-a.example'
  );
  assert v_again.provider_id=v_first.provider_id
     and (select status from public.providers where id=v_first.provider_id)='hidden',
    'Upsert reuses a hidden provider without implicitly reactivating it';

  perform public.admin_set_provider_status(v_first.provider_id,'active');
  perform public.admin_set_provider_brand(v_first.provider_id,null);
  assert (select brand_id from public.providers where id=v_first.provider_id) is null,
    'Brand RPC can unlink a provider';

  select count(*) into v_audit_after
  from public.admin_audit_logs
  where entity_type in ('provider','online_store');

  assert v_audit_after>v_audit_before,
    'Provider and online-store admin writes are audited';

  reset role;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;

  v_pick := public.change_pick(v_cat_a,v_first.item_id,'온라인 공식몰 원픽');
  assert v_pick.status='active' and v_pick.item_id=v_first.item_id,
    'Active online provider item remains pickable';

  reset role;

  insert into op_ids values
    ('provider',v_first.provider_id),
    ('item',v_first.item_id),
    ('platform_provider',v_platform.provider_id);
end;
$flow$;
$test$, 'AAL2 online provider workflow is atomic, idempotent and auditable');

select throws_ok(
  $$select private.canonical_online_store_key(
      'platform_store',
      'https://example.org/not-a-shop',
      'unknown_platform',
      'unknown_platform:merchant'
    )$$,
  'P0001',
  'ONLINE_STORE_PLATFORM_HOST_INVALID',
  'Platform stores require a recognized shopping host'
);

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  v_admin uuid := (select id from op_ids where key='admin');
  v_cat_a uuid := (select id from op_ids where key='cat_a');
  v_brand uuid := (select id from op_ids where key='brand');
  v_provider uuid := (select id from op_ids where key='provider');
  v_item uuid := (select id from op_ids where key='item');
  v_target uuid := gen_random_uuid();
  v_orphan uuid := gen_random_uuid();
begin
  -- Direct brand writes on provider-backed items are blocked even for AAL2 admins.
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  begin
    update public.items
    set brand_id=v_brand
    where id=v_item;
    assert false,'provider-backed item brand update must fail';
  exception when check_violation then
    assert sqlerrm='ITEM_PROVIDER_BRAND_CONFLICT',
      'provider-backed item inherits brand only through provider';
  end;
  reset role;

  -- Provider-backed online item external identity cannot be rewritten directly.
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  begin
    update public.items
    set external_id='tampered:'||v_item::text
    where id=v_item;
    set constraints all immediate;
    assert false,'provider-backed item external identity update must fail';
  exception when check_violation then
    assert sqlerrm='ONLINE_PROVIDER_ITEM_EXTERNAL_ID_INVALID',
      'online provider item external identity is derived from provider/category';
  end;
  set constraints all deferred;
  reset role;

  -- Active onepick_provider rows cannot commit without item_providers.
  begin
    insert into public.items(
      id,category_id,name,normalized_name,status,external_source,external_id
    ) values(
      v_orphan,v_cat_a,'고아 온라인몰','고아온라인몰','active',
      'onepick_provider','orphan-'||v_orphan::text
    );
    set constraints all immediate;
    assert false,'orphan online provider item must fail';
  exception when check_violation then
    assert sqlerrm='ONLINE_PROVIDER_ITEM_ORPHANED',
      'onepick_provider item requires provider mapping';
  end;
  set constraints all deferred;

  -- A provider-backed pending source cannot be merged away.
  insert into public.items(
    id,category_id,name,normalized_name,status
  ) values(
    v_target,v_cat_a,'일반 병합 대상','일반병합대상','active'
  );

  update public.items set status='pending' where id=v_item;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  begin
    perform public.admin_merge_pending_item(v_item,v_target);
    assert false,'provider-backed merge source must fail';
  exception when sqlstate 'P0001' then
    assert sqlerrm='SOURCE_PROVIDER_ITEM_NOT_MERGEABLE',
      'merge guard protects provider-backed source identity';
  end;
  reset role;

  update public.items set status='active' where id=v_item;

  -- Provider identity remains immutable.
  begin
    update public.providers
    set kind='offline_branch'
    where id=v_provider;
    assert false,'provider identity update must fail';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PROVIDER_IDENTITY_IMMUTABLE',
      'existing provider identity guard remains active';
  end;

  set constraints all immediate;
  set constraints all deferred;
end;
$flow$;
$test$, 'Provider item invariants block direct-write and merge bypasses');

select * from finish();
rollback;
