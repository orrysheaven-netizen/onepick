begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values(
  'f9910000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'client-error-sec@example.invalid',
  '',
  now(),
  now()
);

insert into public.profiles(id,username,onboarding_completed)
values(
  'f9910000-0000-4000-8000-000000000001',
  'client_error_sec',
  true
);

select ok(
  has_column_privilege('authenticated','public.client_error_events','user_id','insert'),
  'authenticated may insert user_id'
);
select ok(
  has_column_privilege('authenticated','public.client_error_events','context','insert'),
  'authenticated may insert context'
);
select ok(
  has_column_privilege('authenticated','public.client_error_events','error_code','insert'),
  'authenticated may insert error_code'
);
select ok(
  has_column_privilege('authenticated','public.client_error_events','platform','insert'),
  'authenticated may insert platform'
);
select ok(
  has_column_privilege('authenticated','public.client_error_events','app_version','insert'),
  'authenticated may insert app_version'
);
select ok(
  not has_column_privilege('authenticated','public.client_error_events','id','insert'),
  'authenticated cannot choose event ids'
);
select ok(
  not has_column_privilege('authenticated','public.client_error_events','created_at','insert'),
  'authenticated cannot forge event timestamps'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9910000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9910000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$insert into public.client_error_events(
      user_id,context,error_code,platform,app_version
    ) values(
      'f9910000-0000-4000-8000-000000000001',
      'screen_home',
      'NETWORK_ERROR',
      'web',
      '1.0.0'
    )$$,
  'normal client error insert keeps working with server-owned id and timestamp'
);

select throws_ok(
  $$insert into public.client_error_events(
      user_id,context,error_code,platform,app_version,created_at
    ) values(
      'f9910000-0000-4000-8000-000000000001',
      'screen_home',
      'NETWORK_ERROR',
      'web',
      '1.0.0',
      '2000-01-01T00:00:00Z'
    )$$,
  '42501',
  null,
  'authenticated caller cannot provide created_at'
);

select throws_ok(
  $$insert into public.client_error_events(
      id,user_id,context,error_code,platform,app_version
    ) values(
      'f9910000-0000-4000-8000-000000000099',
      'f9910000-0000-4000-8000-000000000001',
      'screen_home',
      'NETWORK_ERROR',
      'web',
      '1.0.0'
    )$$,
  '42501',
  null,
  'authenticated caller cannot provide id'
);

reset role;

select ok(
  exists (
    select 1
    from public.client_error_events
    where user_id='f9910000-0000-4000-8000-000000000001'
      and id is not null
      and created_at > now() - interval '1 minute'
  ),
  'successful client insert receives server defaults'
);

select * from finish();
rollback;
