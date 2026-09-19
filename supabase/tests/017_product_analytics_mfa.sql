begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(4);

select like(
  (select qual from pg_policies
   where schemaname='public'
     and tablename='product_analytics_events'
     and policyname='product_analytics_events_select_admin'),
  '%private.is_admin_mfa%',
  'Analytics SELECT policy delegates to the MFA-aware admin check'
);

insert into auth.users(id,aud,role,created_at,updated_at) values
  ('a7171717-1717-4717-8717-171717171717','authenticated','authenticated',now(),now()),
  ('b7171717-1717-4717-8717-171717171717','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('a7171717-1717-4717-8717-171717171717','mfaadmin',true),
  ('b7171717-1717-4717-8717-171717171717','mfamember',true);
insert into private.admin_users(user_id)
values('a7171717-1717-4717-8717-171717171717');
insert into public.product_analytics_events(event_name,source,path)
values('auth_started','mfa_policy_fixture','/auth/login');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','a7171717-1717-4717-8717-171717171717',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select is(
  (select count(*) from public.product_analytics_events where source='mfa_policy_fixture'),
  0::bigint,
  'AAL1 admin cannot read analytics events directly'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','a7171717-1717-4717-8717-171717171717',
    'role','authenticated',
    'aal','aal2'
  )::text,
  true
);
select is(
  (select count(*) from public.product_analytics_events where source='mfa_policy_fixture'),
  1::bigint,
  'AAL2 admin can read analytics events'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','b7171717-1717-4717-8717-171717171717',
    'role','authenticated',
    'aal','aal2'
  )::text,
  true
);
select is(
  (select count(*) from public.product_analytics_events where source='mfa_policy_fixture'),
  0::bigint,
  'Non-admin AAL2 user cannot read analytics events'
);

select * from finish();
rollback;
