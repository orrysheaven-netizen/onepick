begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_admin uuid := 'a3333333-3333-4333-8333-333333333331';
  v_real uuid := 'a3333333-3333-4333-8333-333333333332';
  v_real2 uuid := 'a3333333-3333-4333-8333-333333333333';
  v_demo uuid := 'a3333333-3333-4333-8333-333333333334';
  -- Seed accounts without a demo_ username: one carries the auth app-metadata
  -- marker, the other is one of demo_seed.sql's fixed ids.
  v_seed_meta uuid := 'a3333333-3333-4333-8333-333333333335';
  v_seed_fixed uuid := 'd0e00005-5555-4555-8555-555555555555';
  v_category uuid := 'b3333333-3333-4333-8333-333333333331';
  v_item uuid := 'c3333333-3333-4333-8333-333333333331';
  v_item2 uuid := 'c3333333-3333-4333-8333-333333333332';
  v_real_pick uuid := 'd3333333-3333-4333-8333-333333333331';
  v_real2_pick uuid := 'd3333333-3333-4333-8333-333333333332';
  v_demo_pick uuid := 'd3333333-3333-4333-8333-333333333333';
  v_admin_pick uuid := 'd3333333-3333-4333-8333-333333333334';
  v_seed_meta_pick uuid := 'd3333333-3333-4333-8333-333333333335';
  v_seed_fixed_pick uuid := 'd3333333-3333-4333-8333-333333333336';
  v_before jsonb;
  v_after jsonb;
  v_cat jsonb;
  v_top jsonb;
  v_expected integer;
  v_today text;
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_real,'authenticated','authenticated',now(),now()),
    (v_real2,'authenticated','authenticated',now(),now()),
    (v_demo,'authenticated','authenticated',now(),now()),
    (v_seed_fixed,'authenticated','authenticated',now(),now());
  insert into auth.users(id,aud,role,raw_app_meta_data,created_at,updated_at) values
    (v_seed_meta,'authenticated','authenticated','{"provider":"anonymous","providers":[],"demo":true}'::jsonb,now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'dash_admin',true),
    (v_real,'dash_real',true),
    (v_real2,'dash_real_two',true),
    (v_demo,'demo_dashboard',true),
    (v_seed_meta,'moodarchive_fixture',true),
    (v_seed_fixed,'weekendpick_fixture',true);
  insert into private.admin_users(user_id) values(v_admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
    values(v_category,'Dashboard fixture','dashboard-fixture','open',true,true,9997);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (v_item,v_category,'Dashboard item','dashboarditem','active'),
    (v_item2,v_category,'Dashboard item two','dashboarditemtwo','active');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,
    true
  );
  v_before := public.admin_onepick_dashboard(30);
  reset role;

  -- Real, demo and admin users each create a Pick; only the real ones count.
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status) values
    (v_real_pick,v_real,v_category,v_item,'Real dashboard pick','active'),
    (v_real2_pick,v_real2,v_category,v_item,'Second real dashboard pick','active'),
    (v_demo_pick,v_demo,v_category,v_item2,'Demo dashboard pick','active'),
    (v_admin_pick,v_admin,v_category,v_item2,'Admin dashboard pick','active'),
    (v_seed_meta_pick,v_seed_meta,v_category,v_item2,'Metadata-marked seed pick','active'),
    (v_seed_fixed_pick,v_seed_fixed,v_category,v_item2,'Fixed-id seed pick','active');
  -- Comments must be written as their author: the community write-limit
  -- trigger rejects rows whose user_id differs from auth.uid().
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_real2,'role','authenticated')::text, true);
  insert into public.comments(pick_id,user_id,body) values (v_real_pick,v_real2,'real comment');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_demo,'role','authenticated')::text, true);
  insert into public.comments(pick_id,user_id,body) values (v_real_pick,v_demo,'demo comment');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text, true);
  insert into public.comments(pick_id,user_id,body) values (v_real_pick,v_admin,'admin comment');
  reset role;
  insert into public.product_analytics_events(user_id,event_name,pick_id,source,path) values
    (v_real,'pick_created',v_real_pick,'fixture','/pick/register'),
    (v_demo,'pick_created',v_demo_pick,'fixture','/pick/register'),
    (v_admin,'pick_created',v_admin_pick,'fixture','/pick/register'),
    (v_real,'pick_share_clicked',v_real_pick,'fixture','/pick/[pickId]'),
    (v_real,'pick_share_clicked',v_admin_pick,'fixture','/pick/[pickId]'),
    (null,'auth_started',null,'fixture','/auth/login');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,
    true
  );
  v_after := public.admin_onepick_dashboard(30);

  assert (v_after->>'days')::int = 30, 'Dashboard reports requested window';
  select count(*)::int into v_expected from public.profiles p where private.is_demo_profile(p.id);
  assert v_expected >= 3 and (v_after->'excluded'->>'demo_users')::int = v_expected,
    'demo_ prefix, auth demo marker and fixed seed id are all counted as demo';
  assert private.is_demo_profile(v_seed_meta), 'auth app-metadata demo marker is detected';
  assert private.is_demo_profile(v_seed_fixed), 'fixed seed id is detected';
  assert private.is_demo_profile(v_demo), 'demo_ username is detected';
  assert not private.is_demo_profile(v_real), 'real user is not demo';
  assert (v_after->'excluded'->>'admin_users')::int >= 1, 'Excluded admin count is reported';

  -- Totals: profiles exclude demo_* and allowlisted admins.
  select count(*)::int into v_expected
  from public.profiles p
  where not private.is_demo_profile(p.id)
    and not private.is_admin(p.id);
  assert (v_after->'totals'->>'users')::int = v_expected,
    'Dashboard user total excludes demo and admin profiles';

  assert (v_after->'totals'->>'active_picks')::int - (v_before->'totals'->>'active_picks')::int = 2,
    'Demo (prefix, marker, fixed id) and admin Picks are excluded from active Pick total';
  assert (v_after->'totals'->>'comments')::int - (v_before->'totals'->>'comments')::int = 1,
    'Demo and admin comments are excluded from comment total';

  assert (v_after->'recent'->>'picks_7d')::int - (v_before->'recent'->>'picks_7d')::int = 2,
    'Recent Pick count excludes demo and admin actors';
  assert (v_after->'recent'->>'active_users_7d')::int - (v_before->'recent'->>'active_users_7d')::int = 2,
    'Active user count includes only real Pick/comment authors';

  -- Daily series covers the window and today's bucket reflects the fixture.
  assert jsonb_array_length(v_after->'daily') = 30, 'Daily series has one bucket per day';
  v_today := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  assert (v_after->'daily'->-1->>'day') = v_today, 'Daily series ends on the Seoul calendar day';
  assert (v_after->'daily'->-1->>'picks')::int - (v_before->'daily'->-1->>'picks')::int = 2,
    'Today bucket counts only real Picks';

  -- Category breakdown for the fixture category.
  select value into v_cat
  from jsonb_array_elements(v_after->'categories')
  where value->>'id' = v_category::text;
  assert v_cat is not null, 'Open fixture category appears in breakdown';
  assert (v_cat->>'active_picks')::int = 2, 'Category active Pick count excludes demo and admin';
  assert (v_cat->>'pickers')::int = 2, 'Category picker count excludes demo and admin';

  -- Top items: the real item has 2 real Picks; the demo/admin-only item is absent.
  select value into v_top
  from jsonb_array_elements(v_after->'top_items')
  where value->>'id' = v_item::text;
  assert v_top is not null and (v_top->>'active_picks')::int = 2, 'Top item counts real Picks';
  assert not exists (
    select 1 from jsonb_array_elements(v_after->'top_items') where value->>'id' = v_item2::text
  ), 'Item picked only by demo/seed/admin users is not listed';

  -- Funnel: demo/admin actors and events on their Picks are dropped; anonymous events stay.
  assert (v_after->'funnel'->>'pick_created')::int - (v_before->'funnel'->>'pick_created')::int = 1,
    'Demo and admin Pick creation events are excluded';
  assert (v_after->'funnel'->>'pick_share_clicked')::int - (v_before->'funnel'->>'pick_share_clicked')::int = 1,
    'Events attached to an admin-owned Pick are excluded';
  assert (v_after->'funnel'->>'auth_started')::int - (v_before->'funnel'->>'auth_started')::int = 1,
    'Anonymous auth starts remain measurable';

  begin
    perform public.admin_onepick_dashboard(3);
    assert false, 'Window below 7 days must fail';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.admin_onepick_dashboard(120);
    assert false, 'Window above 90 days must fail';
  exception when sqlstate '22023' then null; end;

  -- AAL1 admin session is refused.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal1')::text,
    true
  );
  begin
    perform public.admin_onepick_dashboard(30);
    assert false, 'Admin without MFA must not read the dashboard';
  exception when insufficient_privilege then null; end;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_real,'role','authenticated','aal','aal2')::text,
    true
  );
  begin
    perform public.admin_onepick_dashboard(30);
    assert false, 'Non-admin user must not read the dashboard';
  exception when insufficient_privilege then null; end;

  reset role;
end;
$flow$;
$test$, 'Admin OnePick dashboard: demo (prefix / auth marker / fixed id) and admin exclusion across totals, recent, daily, categories, top items and funnel; window validation; MFA admin authorization');

select * from finish();
rollback;
