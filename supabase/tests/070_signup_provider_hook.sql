begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create temporary table hook_case(label text, event jsonb, allowed boolean) on commit drop;
insert into hook_case values
  ('Kakao sign-up is allowed',
   '{"user":{"is_anonymous":false,"app_metadata":{"provider":"kakao","providers":["kakao"]}}}', true),
  ('Apple sign-up is allowed',
   '{"user":{"is_anonymous":false,"app_metadata":{"provider":"apple","providers":["apple"]}}}', true),
  ('Google sign-up is rejected',
   '{"user":{"is_anonymous":false,"app_metadata":{"provider":"google","providers":["google"]}}}', false),
  ('Naver custom OIDC sign-up is rejected',
   '{"user":{"is_anonymous":false,"app_metadata":{"provider":"custom:naver","providers":["custom:naver"]}}}', false),
  ('Email/password sign-up is rejected',
   '{"user":{"email":"bot@example.invalid","is_anonymous":false,"app_metadata":{"provider":"email","providers":["email"]}}}', false),
  ('Phone sign-up is rejected',
   '{"user":{"phone":"821000000000","is_anonymous":false,"app_metadata":{"provider":"phone","providers":["phone"]}}}', false),
  ('Anonymous sign-in is rejected even if it claims a social provider',
   '{"user":{"is_anonymous":true,"app_metadata":{"provider":"kakao"}}}', false),
  ('Missing anonymity flag is rejected even for an allowed provider',
   '{"user":{"app_metadata":{"provider":"kakao","providers":["kakao"]}}}', false),
  ('A payload without a provider is rejected',
   '{"user":{}}', false);

select is(
  (select count(*)::int from hook_case
   where (public.hook_before_user_created(event) = '{}'::jsonb) is distinct from allowed),
  0,
  'Only Kakao and Apple sign-ups pass: ' || (
    select coalesce(string_agg(label, '; '), 'all cases matched') from hook_case
    where (public.hook_before_user_created(event) = '{}'::jsonb) is distinct from allowed)
);

select is(
  public.hook_before_user_created('{"user":{"app_metadata":{"provider":"email"}}}') -> 'error' ->> 'http_code',
  '403',
  'Rejected sign-ups return HTTP 403 to Supabase Auth'
);

select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
  'Supabase Auth can run the hook');
select ok(not has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute'),
  'anon cannot call the hook');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'),
  'authenticated cannot call the hook');

select ok(public.hook_before_user_created(event) = '{}'::jsonb, label)
from hook_case where label in ('Kakao sign-up is allowed', 'Apple sign-up is allowed');
select ok(public.hook_before_user_created(event) ? 'error', label)
from hook_case where label in ('Email/password sign-up is rejected', 'Anonymous sign-in is rejected even if it claims a social provider', 'Naver custom OIDC sign-up is rejected');

select * from finish();
rollback;
