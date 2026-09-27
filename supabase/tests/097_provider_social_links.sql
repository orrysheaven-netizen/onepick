begin;

create extension if not exists pgtap with schema extensions;
select plan(8);
set local plpgsql.check_asserts = on;

create temporary table psl_ids(
  key text primary key,
  id uuid not null
) on commit drop;
grant select on psl_ids to anon, authenticated;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_provider uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_user,'authenticated','authenticated',now(),now());

  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'psl_admin_'||substr(replace(v_admin::text,'-',''),1,8),true),
    (v_user,'psl_user_'||substr(replace(v_user::text,'-',''),1,8),true);

  insert into private.admin_users(user_id) values(v_admin);

  insert into public.online_stores(id,store_type,host,store_key,official_url)
  values(v_store,'official_site','social-provider.example','site:social-provider.example','https://social-provider.example');

  insert into public.providers(id,kind,name,online_store_id,status)
  values(v_provider,'online_store','SNS 테스트 판매처',v_store,'active');

  insert into psl_ids values('admin',v_admin),('user',v_user),('provider',v_provider);
end;
$fixtures$;

select ok(
  has_table_privilege('authenticated','public.provider_social_links','select')
  and not has_table_privilege('authenticated','public.provider_social_links','insert')
  and not has_table_privilege('authenticated','public.provider_social_links','update')
  and not has_table_privilege('authenticated','public.provider_social_links','delete'),
  'Authenticated clients can read but cannot write provider social links directly'
);

select set_config('request.jwt.claim.sub',(select id::text from psl_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $sql$select count(*) from public.admin_replace_provider_social_links(
    (select id from psl_ids where key='provider'),
    '[{"platform":"instagram","url":"https://instagram.com/example"}]'::jsonb
  )$sql$,
  '42501',
  null,
  'Allowlisted AAL1 admin cannot edit provider social links'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from psl_ids where key='user'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $sql$select count(*) from public.admin_replace_provider_social_links(
    (select id from psl_ids where key='provider'),
    '[{"platform":"instagram","url":"https://instagram.com/example"}]'::jsonb
  )$sql$,
  '42501',
  null,
  'Non-admin AAL2 user cannot edit provider social links'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from psl_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select lives_ok(
  $sql$select count(*) from public.admin_replace_provider_social_links(
    (select id from psl_ids where key='provider'),
    '[
      {"platform":"YouTube","url":"https://youtube.com/@onepick","sort_order":2},
      {"platform":"instagram","url":"https://instagram.com/onepick","sort_order":1}
    ]'::jsonb
  )$sql$,
  'AAL2 admin atomically replaces provider social links'
);
reset role;

select is(
  (select string_agg(platform||':'||sort_order::text,',' order by sort_order,platform)
   from public.provider_social_links
   where provider_id=(select id from psl_ids where key='provider')),
  'instagram:1,youtube:2',
  'Platforms are normalized and stored in explicit display order'
);

set local role anon;
select is(
  (select count(*)::integer from public.provider_social_links
   where provider_id=(select id from psl_ids where key='provider')),
  2,
  'Anonymous visitors can read social links for an active public provider'
);
reset role;

update public.providers
set status='hidden'
where id=(select id from psl_ids where key='provider');

set local role anon;
select is(
  (select count(*)::integer from public.provider_social_links
   where provider_id=(select id from psl_ids where key='provider')),
  0,
  'Anonymous visitors cannot read links for a hidden provider'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from psl_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select is(
  (select count(*)::integer from public.provider_social_links
   where provider_id=(select id from psl_ids where key='provider')),
  2,
  'AAL2 admin can still read links for a hidden provider'
);

select throws_ok(
  $sql$select count(*) from public.admin_replace_provider_social_links(
    (select id from psl_ids where key='provider'),
    '[
      {"platform":"instagram","url":"https://instagram.com/a"},
      {"platform":"instagram","url":"https://instagram.com/b"}
    ]'::jsonb
  )$sql$,
  'P0001',
  'PROVIDER_SOCIAL_LINK_INVALID',
  'Duplicate platforms are rejected'
);
reset role;

select * from finish();
rollback;
