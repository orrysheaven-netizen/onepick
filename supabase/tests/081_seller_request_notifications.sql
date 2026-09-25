begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
set local plpgsql.check_asserts = on;

create temporary table srn_ids(key text primary key, id uuid not null) on commit drop;
grant select on srn_ids to authenticated;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cat uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_open uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now()),
    (v_other,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'srn_admin_'||substr(replace(v_admin::text,'-',''),1,8),true),
    (v_user,'srn_user_'||substr(replace(v_user::text,'-',''),1,8),true),
    (v_other,'srn_other_'||substr(replace(v_other::text,'-',''),1,8),true);
  insert into private.admin_users(user_id) values(v_admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_cat,'알림 테스트 탕','srn-'||substr(replace(v_cat::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes)
    values(v_cat,'internal',true,true,'seller request notification test');
  insert into public.items(id,category_id,name,normalized_name,status,official_url,created_by) values
    (v_request,v_cat,'알림곰탕 온라인몰','알림곰탕온라인몰','pending','https://smartstore.example/alim',v_user),
    (v_open,v_cat,'미처리 요청','미처리요청','pending','https://smartstore.example/open',v_user);
  insert into srn_ids values ('admin',v_admin),('user',v_user),('other',v_other),('cat',v_cat),('request',v_request),('open',v_open);
end;
$fixtures$;

-- Nobody but an AAL2 admin can write a notification, and only for a merged request.
select set_config('request.jwt.claim.sub',(select id::text from srn_ids where key='user'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select private.notify_online_seller_request_resolved((select id from srn_ids where key='open'),(select id from srn_ids where key='open'))$$,
  '42501', null,
  'A normal user cannot forge a seller-request notification'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from srn_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select private.notify_online_seller_request_resolved((select id from srn_ids where key='open'),(select id from srn_ids where key='request'))$$,
  'P0001', 'REQUEST_NOT_RESOLVED',
  'Even an admin cannot notify for a request that was not merged into that item'
);

create temporary table srn_resolved on commit drop as
  select * from public.admin_resolve_online_seller_request(
    (select id from srn_ids where key='request'),'알림곰탕 공식몰','official_site','https://smartstore.example/alim');
grant select on srn_resolved to authenticated;
reset role;

select is(
  (select count(*)::int from public.item_request_notifications
    where request_item_id=(select id from srn_ids where key='request')
      and recipient_id=(select id from srn_ids where key='user')
      and resolved_item_id=(select item_id from srn_resolved)),
  1,
  'Resolving a request notifies its requester exactly once'
);

select set_config('request.jwt.claim.sub',(select id::text from srn_ids where key='user'),true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
set local role authenticated;
select lives_ok($test$
do $flow$
declare
  v_request uuid := (select id from srn_ids where key='request');
  v_cat uuid := (select id from srn_ids where key='cat');
  r record;
begin
  assert public.notification_count() >= 1, 'The requester sees an unread notification';
  select * into r from public.notification_page() f where f.kind='seller_request' and f.id=v_request;
  assert found, 'The inbox lists the resolved request';
  assert r.item_id=(select item_id from srn_resolved) and r.category_id=v_cat, 'The row carries what the choose screen needs';
  assert r.item_name='알림곰탕 공식몰' and r.body='알림 테스트 탕' and r.pick_id is null;
  update public.item_request_notifications set read_at=now() where request_item_id=v_request;
  assert (select read_at from public.notification_page() f where f.id=v_request) is not null, 'The requester can mark it read';
end;
$flow$;
$test$, 'The requester reads and marks the seller-request notification through the unified inbox');
reset role;

select set_config('request.jwt.claim.sub',(select id::text from srn_ids where key='other'),true);
set local role authenticated;
select is(
  (select count(*)::int from public.notification_page() f where f.kind='seller_request'),
  0,
  'Other users never see someone else''s request notification'
);
reset role;

select ok(
  not has_function_privilege('anon','public.notification_page(timestamptz,uuid)','execute')
  and has_function_privilege('authenticated','public.notification_page(timestamptz,uuid)','execute'),
  'The recreated inbox keeps its grants'
);

select * from finish();
rollback;
