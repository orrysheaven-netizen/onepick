begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
set local plpgsql.check_asserts = on;

create temporary table osr_ids(key text primary key, id uuid not null) on commit drop;
grant select on osr_ids to authenticated;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_cat uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_delivery uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'osr_admin_'||substr(replace(v_admin::text,'-',''),1,8),true),
    (v_user,'osr_user_'||substr(replace(v_user::text,'-',''),1,8),true);
  insert into private.admin_users(user_id) values(v_admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_cat,'온라인 요청 테스트 탕','osr-'||substr(replace(v_cat::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes)
    values(v_cat,'internal',true,true,'online seller request test');
  insert into public.items(id,category_id,name,normalized_name,status,official_url,created_by) values
    (v_request,v_cat,'테스트곰탕 온라인몰','테스트곰탕온라인몰','pending','https://smartstore.example/gomtang',v_user),
    (v_delivery,v_cat,'배달 요청','배달요청','pending','https://s.baemin.com/store/1',v_user);
  insert into osr_ids values ('admin',v_admin),('user',v_user),('cat',v_cat),('request',v_request),('delivery',v_delivery);
end;
$fixtures$;

select set_config('request.jwt.claim.sub',(select id::text from osr_ids where key='user'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_resolve_online_seller_request(
      (select id from osr_ids where key='request'),'침입','official_site','https://smartstore.example/gomtang')$$,
  '42501', null,
  'Non-admins cannot resolve online seller requests'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from osr_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;

select lives_ok($test$
do $flow$
declare
  v_request uuid := (select id from osr_ids where key='request');
  v_cat uuid := (select id from osr_ids where key='cat');
  r record;
  v_merged public.items%rowtype;
begin
  select * into r from public.admin_resolve_online_seller_request(
    v_request,'테스트곰탕 공식몰','official_site','https://smartstore.example/gomtang');
  assert r.category_id=v_cat, 'The online provider item lands in the request category';
  assert r.merged_item_id=v_request;
  select * into v_merged from public.items where id=v_request;
  assert v_merged.status='merged' and v_merged.merged_into_item_id=r.item_id, 'The request is merged into the provider item';
  assert exists(select 1 from public.item_channels where item_id=r.item_id and channel='online'),
    'The resolved item is an online-channel item (shows under the 온라인 tab)';
  assert (select status from public.items where id=r.item_id)='active';
end;
$flow$;
$test$, 'An AAL2 admin turns a pending online seller request into an online provider item and merges it');

select throws_ok(
  $$select * from public.admin_resolve_online_seller_request(
      (select id from osr_ids where key='request'),'두번째','official_site','https://smartstore.example/gomtang')$$,
  'P0001', 'SOURCE_ITEM_NOT_PENDING',
  'An already resolved request cannot be resolved again'
);

select throws_ok(
  $$select * from public.admin_resolve_online_seller_request(
      (select id from osr_ids where key='delivery'),'배달 가게','official_site','https://s.baemin.com/store/1')$$,
  '23514', null,
  'A delivery-app link cannot become an online seller, and the request stays pending'
);
reset role;

select * from finish();
rollback;
