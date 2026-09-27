begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

create temporary table aic_ids(key text primary key, id uuid not null) on commit drop;
grant select on aic_ids to authenticated;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_root uuid := gen_random_uuid();
  v_from uuid := gen_random_uuid();
  v_to uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    values(v_admin,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
    values(v_admin,'aic_admin_'||substr(v_suffix,1,8),true);
  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_root,'감사 테스트 먹을것','aicroot-'||v_suffix,'open',true,false);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (v_from,v_root,'감사 테스트 원래','aicfrom-'||v_suffix,'open',true,true),
    (v_to,v_root,'감사 테스트 대상','aicto-'||v_suffix,'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (v_from,'internal',true,false,'audit test'),
    (v_to,'internal',true,false,'audit test');
  insert into public.items(id,category_id,name,normalized_name,status)
    values(v_item,v_from,'감사이동','감사이동','active');

  insert into aic_ids values ('admin',v_admin),('from',v_from),('to',v_to),('item',v_item);
end;
$fixtures$;

select set_config('request.jwt.claim.sub',(select id::text from aic_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;

select lives_ok(
  $$select public.admin_move_item_category((select id from aic_ids where key='item'),(select id from aic_ids where key='to'))$$,
  'Fixture: an AAL2 admin moves the item'
);
reset role;

select is(
  (select l.summary from public.admin_audit_logs l
    where l.entity_type='item' and l.entity_id=(select id from aic_ids where key='item') and l.action='update'),
  jsonb_build_object(
    'name','감사이동',
    'status','active',
    'category_id',(select id from aic_ids where key='to')::text,
    'previous_category_id',(select id from aic_ids where key='from')::text
  ),
  'A category move keeps both the old and the new category in the audit row'
);

-- Other item edits keep the summary they had (the admin claim is still set).
update public.items set status='discontinued' where id=(select id from aic_ids where key='item');
select is(
  (select array_agg(l.summary ? 'previous_category_id' order by l.summary->>'status')
     from public.admin_audit_logs l
    where l.entity_id=(select id from aic_ids where key='item') and l.action='update'),
  array[true,false],
  'An update that leaves the category alone records no previous_category_id'
);

select * from finish();
rollback;
