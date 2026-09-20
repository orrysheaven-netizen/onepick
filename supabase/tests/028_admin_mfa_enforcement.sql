-- Administrator database access must require BOTH admin-list membership and
-- an AAL2 (step-up MFA) session. This suite proves:
--   * private.is_admin(uuid)/public.current_user_is_admin() stay membership-only,
--     so an allowlisted admin who has not stepped up yet can still reach the
--     MFA enrollment/verification flow (see docs/admin-mfa.md).
--   * private.is_admin_mfa() -- the gate now used by every real admin RLS
--     policy and SECURITY DEFINER RPC -- rejects an admin session at AAL1
--     (including "no aal claim at all") and accepts one at AAL2.
--   * A non-admin cannot forge their way past the gate by claiming aal2.
--   * Anonymous callers still have no path to any of this.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('aa000001-0000-4000-8000-000000000001','authenticated','authenticated','mfa-admin@example.com','',now(),now()),
('aa000001-0000-4000-8000-000000000002','authenticated','authenticated','mfa-user@example.com','',now(),now()),
('aa000001-0000-4000-8000-000000000003','authenticated','authenticated','mfa-target@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('aa000001-0000-4000-8000-000000000001','mfa_admin',true),
('aa000001-0000-4000-8000-000000000002','mfa_user',true),
('aa000001-0000-4000-8000-000000000003','mfa_target',true);
insert into private.admin_users(user_id) values ('aa000001-0000-4000-8000-000000000001');

-- Fixture for admin_merge_pending_item: a pending source item and an eligible
-- active target item in the same category.
insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
('aa000003-0000-4000-8000-000000000001','MFA 병합 테스트','mfa-merge-test','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status) values
('aa000004-0000-4000-8000-000000000001','aa000003-0000-4000-8000-000000000001','MFA 병합 원본','mfa병합원본','pending'),
('aa000004-0000-4000-8000-000000000002','aa000003-0000-4000-8000-000000000001','MFA 병합 대상','mfa병합대상','active');

set local role authenticated;

-- Admin identity, no aal claim at all (an AAL1 session looks exactly like this).
select set_config('request.jwt.claim.sub','aa000001-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{}',true);

select ok(public.current_user_is_admin(),'membership check stays true for an AAL1 admin so enrollment is never locked out');
select ok(not private.is_admin_mfa(),'AAL2 gate rejects an admin session with no aal claim');

select throws_ok(
  $$insert into public.categories(name,slug,status,is_visible,is_pickable) values('AAL1 차단','aal1-blocked','draft',false,false)$$,
  '42501', null, 'AAL1 admin (no aal claim) cannot insert a category'
);
select throws_ok(
  $$select public.admin_dashboard_metrics()$$,
  '42501', null, 'AAL1 admin (no aal claim) cannot call admin_dashboard_metrics'
);
select throws_ok(
  $$select public.admin_set_user_suspension('aa000001-0000-4000-8000-000000000003',true,'test')$$,
  '42501', null, 'AAL1 admin (no aal claim) cannot suspend a user'
);
select throws_ok(
  $$select public.admin_merge_pending_item('aa000004-0000-4000-8000-000000000001','aa000004-0000-4000-8000-000000000002')$$,
  '42501', null, 'AAL1 admin (no aal claim) cannot merge a pending item'
);

-- Explicit aal1 (as opposed to simply absent) must behave identically.
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select ok(not private.is_admin_mfa(),'AAL2 gate rejects an explicit aal1 session');
select throws_ok(
  $$insert into public.categories(name,slug,status,is_visible,is_pickable) values('AAL1 명시 차단','aal1-explicit-blocked','draft',false,false)$$,
  '42501', null, 'explicit-aal1 admin cannot insert a category'
);

-- Step up to AAL2: the same admin identity, now authorized everywhere.
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select ok(private.is_admin_mfa(),'AAL2 gate accepts an admin session with aal2');

select lives_ok(
  $$insert into public.categories(id,name,slug,status,is_visible,is_pickable) values('aa000002-0000-4000-8000-000000000001','AAL2 허용','aal2-allowed','draft',false,false)$$,
  'AAL2 admin can insert a category'
);
select lives_ok($$select public.admin_dashboard_metrics()$$,'AAL2 admin can call admin_dashboard_metrics');
select lives_ok(
  $$select public.admin_set_user_suspension('aa000001-0000-4000-8000-000000000003',true,'AAL2 검증')$$,
  'AAL2 admin can suspend a user'
);
select ok(private.user_is_suspended('aa000001-0000-4000-8000-000000000003'),'suspension actually took effect under AAL2');

-- Un-suspend so later assertions in this file are not affected.
select public.admin_set_user_suspension('aa000001-0000-4000-8000-000000000003',false,null);

select lives_ok(
  $$select public.admin_merge_pending_item('aa000004-0000-4000-8000-000000000001','aa000004-0000-4000-8000-000000000002')$$,
  'AAL2 admin can merge a pending item into an active item in the same category'
);
select is(
  (select status from public.items where id='aa000004-0000-4000-8000-000000000001'),
  'merged','merged source item status is updated'
);
select is(
  (select merged_into_item_id from public.items where id='aa000004-0000-4000-8000-000000000001'),
  'aa000004-0000-4000-8000-000000000002'::uuid,
  'merged source item points at the target item'
);

-- A non-admin cannot bypass the gate by simply claiming aal2: membership is
-- still required, so forging the claim must not grant any extra access.
select set_config('request.jwt.claim.sub','aa000001-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select ok(not public.current_user_is_admin(),'ordinary user is not admin regardless of aal');
select ok(not private.is_admin_mfa(),'AAL2 gate rejects a non-admin even with a forged aal2 claim');
select throws_ok(
  $$insert into public.categories(name,slug,status,is_visible,is_pickable) values('일반 사용자','ordinary-blocked','draft',false,false)$$,
  '42501', null, 'ordinary user with a forged aal2 claim still cannot insert a category'
);
select throws_ok(
  $$select public.admin_dashboard_metrics()$$,
  '42501', null, 'ordinary user with a forged aal2 claim still cannot call admin_dashboard_metrics'
);

-- Anonymous callers have no path to the gate at all.
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
-- anon holds schema usage only because public.user_is_suspended now lives in
-- private (needed by the anon-facing read policies that call it); it still
-- has no execute grant on the actual AAL2 gate function.
select ok(not has_function_privilege('anon','private.is_admin_mfa()','execute'),'anonymous cannot execute the private AAL2 gate function');
select ok(not has_function_privilege('anon','public.admin_dashboard_metrics()','execute'),'anonymous cannot execute admin_dashboard_metrics');
reset role;

select * from finish();
rollback;
