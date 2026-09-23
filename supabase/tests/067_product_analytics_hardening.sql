begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,created_at,updated_at) values
  ('a6700000-0000-4000-8000-000000000001','authenticated','authenticated',now(),now()),
  ('a6700000-0000-4000-8000-000000000002','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('a6700000-0000-4000-8000-000000000001','ana_limit_admin',true),
  ('a6700000-0000-4000-8000-000000000002','ana_limit_user',true);
insert into private.admin_users(user_id) values ('a6700000-0000-4000-8000-000000000001');
-- Isolate the shared anonymous quota; everything is rolled back at the end.
delete from private.analytics_event_limits where user_id is null;

select ok(not has_table_privilege('anon','public.product_analytics_events','insert'), 'anon cannot directly insert');
select ok(not has_table_privilege('authenticated','public.product_analytics_events','insert'), 'authenticated cannot directly insert');
select ok(not has_table_privilege('anon','private.analytics_event_limits','select'), 'anon cannot read quota');
select ok(not has_table_privilege('authenticated','private.analytics_event_limits','update'), 'users cannot reset quota');

-- RPC tests use JWT claims only, like the existing pick/RPC fixtures.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
select lives_ok($$do $body$ begin
  for i in 1..120 loop
    perform public.capture_product_event('auth_started', p_source => 'analytics-quota-test');
  end loop;
end $body$;$$, '120 anonymous events are accepted');
select throws_ok($$select public.capture_product_event('auth_started')$$,
  'P0001','RATE_LIMITED','121st anonymous event is rate limited');
select is((select count(*) from public.product_analytics_events where source='analytics-quota-test'),
  120::bigint,'rejected event does not create a row');
select is((select requests from private.analytics_event_limits where user_id is null),120,'failed quota reservation rolls back');
select ok((select bool_and(user_id is null) from public.product_analytics_events where source='analytics-quota-test'),
  'anonymous events have no user');

select set_config('request.headers','{"x-forwarded-for":"203.0.113.1","x-session-id":"rotated"}',true);
select throws_ok($$select public.capture_product_event('auth_started')$$,
  'P0001','RATE_LIMITED','forged IP/session headers cannot bypass anonymous quota');
update private.analytics_event_limits set window_start=now()-interval '1 minute' where user_id is null;
select lives_ok($$select public.capture_product_event('auth_started')$$,'anonymous quota renews at one minute');
select is((select requests from private.analytics_event_limits where user_id is null),1,'renewed anonymous counter starts at one');
select throws_ok($$select public.capture_product_event('not_an_event')$$,
  '23514',null,'event-name CHECK remains enforced');
select throws_ok($$select public.capture_product_event('auth_started',p_source=>repeat('x',41))$$,
  '23514',null,'payload length CHECK remains enforced');
select throws_ok($$select public.capture_product_event('auth_started',p_pick_id=>'a6700000-0000-4000-8000-000000000099')$$,
  '23503',null,'foreign key CHECK remains enforced');
select is((select requests from private.analytics_event_limits where user_id is null),1,'invalid payloads do not consume quota');

select set_config('request.jwt.claims','{"sub":"a6700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select lives_ok($$do $body$ begin
  for i in 1..60 loop
    perform public.capture_product_event('auth_completed',p_source=>'analytics-user-test');
  end loop;
end $body$;$$,'60 authenticated events are accepted');
select throws_ok($$select public.capture_product_event('auth_completed')$$,
  'P0001','RATE_LIMITED','61st user event is rate limited');
select is((select count(*) from public.product_analytics_events
  where source='analytics-user-test' and user_id='a6700000-0000-4000-8000-000000000001'),
  60::bigint,'server attributes events to the JWT user');
select ok((select bool_and(created_at=now()) from public.product_analytics_events where source='analytics-user-test'),
  'server supplies event timestamps');
select set_config('request.jwt.claims','{"sub":"a6700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.capture_product_event('auth_completed')$$,'other users have independent quota');
update private.analytics_event_limits set window_start=now()-interval '2 minutes'
  where user_id='a6700000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"a6700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select lives_ok($$select public.capture_product_event('auth_completed')$$,'user quota renews after expiry');
select is((select requests from private.analytics_event_limits where user_id='a6700000-0000-4000-8000-000000000001'),
  1,'renewed user counter starts at one');

-- Role switching here tests actual table ACL/RLS and wrapper EXECUTE privileges,
-- not pick mutation RPCs, which are intentionally left alone.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select lives_ok($$select public.capture_product_event('auth_started')$$,'anon can execute the invoker wrapper');
select throws_ok($$insert into public.product_analytics_events(event_name) values ('auth_started')$$,
  '42501',null,'direct anon insert is denied by the database');
select throws_ok($$select * from public.product_analytics_events$$,'42501',null,'anon cannot read analytics');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select lives_ok($$select public.capture_product_event('auth_completed')$$,'authenticated can execute the invoker wrapper');
select throws_ok($$insert into public.product_analytics_events(event_name) values ('auth_completed')$$,
  '42501',null,'direct authenticated insert is denied');
select is((select count(*) from public.product_analytics_events),0::bigint,'AAL1 admin cannot read analytics');
select set_config('request.jwt.claims','{"sub":"a6700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.product_analytics_events where source='analytics-quota-test'),
  120::bigint,'AAL2 admin can read analytics');
select set_config('request.jwt.claims','{"sub":"a6700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.product_analytics_events),0::bigint,'AAL2 non-admin cannot read analytics');
reset role;

select * from finish();
rollback;
