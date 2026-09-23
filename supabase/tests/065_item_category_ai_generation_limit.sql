begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values(
  'f9800000-0000-4000-8000-000000000001',
  'authenticated','authenticated','ai-quota@example.invalid','',now(),now()
);
insert into public.profiles(id,username,onboarding_completed)
values('f9800000-0000-4000-8000-000000000001','ai_quota_user',true);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_item_category_ai_generation(uuid)',
    'execute'
  ),
  'authenticated clients cannot reserve paid AI generations directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.item_category_ai_generation_limits',
    'select'
  ),
  'authenticated clients cannot inspect AI quota counters'
);

set local role service_role;

select ok(
  (select bool_and(public.reserve_item_category_ai_generation(
    'f9800000-0000-4000-8000-000000000001'
  )) from generate_series(1,10)),
  'first ten uncached AI category generations in one hour are allowed'
);
select ok(
  not public.reserve_item_category_ai_generation(
    'f9800000-0000-4000-8000-000000000001'
  ),
  'eleventh AI category generation in one hour is denied'
);
select is(
  (select used_count from public.item_category_ai_generation_limits
   where user_id='f9800000-0000-4000-8000-000000000001'),
  10,
  'denied reservations do not increment the paid generation counter'
);

update public.item_category_ai_generation_limits
set window_started_at=statement_timestamp()-interval '2 hours'
where user_id='f9800000-0000-4000-8000-000000000001';

select ok(
  public.reserve_item_category_ai_generation(
    'f9800000-0000-4000-8000-000000000001'
  ),
  'AI generation quota resets after one hour'
);
select is(
  (select used_count from public.item_category_ai_generation_limits
   where user_id='f9800000-0000-4000-8000-000000000001'),
  1,
  'reset starts a new reservation window at one'
);

reset role;

select * from finish();
rollback;
