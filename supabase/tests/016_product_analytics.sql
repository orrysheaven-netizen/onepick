begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_admin uuid := 'a6161616-1616-4616-8616-161616161616';
  v_real uuid := 'b6161616-1616-4616-8616-161616161616';
  v_demo uuid := 'c6161616-1616-4616-8616-161616161616';
  v_category uuid := 'd6161616-1616-4616-8616-161616161616';
  v_item uuid := 'e6161616-1616-4616-8616-161616161616';
  v_real_pick uuid := 'f6161616-1616-4616-8616-161616161611';
  v_demo_pick uuid := 'f6161616-1616-4616-8616-161616161612';
  v_before jsonb;
  v_after jsonb;
  v_expected integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_real,'authenticated','authenticated',now(),now()),
    (v_demo,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'ana_admin',true),
    (v_real,'ana_real',true),
    (v_demo,'demo_analytics',true);
  insert into private.admin_users(user_id) values(v_admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
    values(v_category,'Analytics fixture','analytics-fixture','open',true,true,9998);
  insert into public.items(id,category_id,name,normalized_name,status)
    values(v_item,v_category,'Analytics item','analyticsitem','active');
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status) values
    (v_real_pick,v_real,v_category,v_item,'Real analytics pick','active'),
    (v_demo_pick,v_demo,v_category,v_item,'Demo analytics pick','active');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,
    true
  );
  v_before := public.admin_operations_snapshot(7);

  select count(*)::int into v_expected
  from public.profiles p
  where p.username not like 'demo\_%' escape '\';
  assert (v_before->'metrics'->>'profiles')::int = v_expected,
    'Operations profile metric excludes demo_* profiles';

  select count(*)::int into v_expected
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  where p.status='active' and pr.username not like 'demo\_%' escape '\';
  assert (v_before->'metrics'->>'active_picks')::int = v_expected,
    'Operations Pick metric excludes demo_* profiles';

  reset role;
  insert into public.product_analytics_events(user_id,event_name,pick_id,source,path) values
    (v_real,'pick_created',v_real_pick,'fixture','/pick/register'),
    (v_demo,'pick_created',v_demo_pick,'fixture','/pick/register'),
    (v_real,'pick_share_clicked',v_real_pick,'fixture','/pick/[pickId]'),
    (v_real,'pick_share_clicked',v_demo_pick,'fixture','/pick/[pickId]'),
    (null,'auth_started',null,'fixture','/auth/login');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,
    true
  );
  v_after := public.admin_operations_snapshot(7);

  assert (v_after->'funnel'->>'days')::int = 7, 'Funnel reports requested window';
  assert (v_after->'funnel'->>'pick_created')::int - (v_before->'funnel'->>'pick_created')::int = 1,
    'Demo actor Pick creation is excluded';
  assert (v_after->'funnel'->>'pick_share_clicked')::int - (v_before->'funnel'->>'pick_share_clicked')::int = 1,
    'Events attached to a demo-owned Pick are excluded';
  assert (v_after->'funnel'->>'auth_started')::int - (v_before->'funnel'->>'auth_started')::int = 1,
    'Anonymous auth starts remain measurable';

  begin
    perform public.admin_operations_snapshot(0);
    assert false, 'Invalid analytics window must fail';
  exception when sqlstate '22023' then null; end;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_real,'role','authenticated','aal','aal2')::text,
    true
  );
  begin
    perform public.admin_operations_snapshot(7);
    assert false, 'Non-admin user must not read operations snapshot';
  exception when insufficient_privilege then null; end;

  reset role;
end;
$flow$;
$test$, 'Admin operations snapshot: demo exclusion, funnel deltas, window validation and MFA admin authorization');

select * from finish();
rollback;
