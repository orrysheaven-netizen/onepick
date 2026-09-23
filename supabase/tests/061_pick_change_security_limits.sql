begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9400000-0000-4000-8000-000000000001','authenticated','authenticated','pick-limit-a@example.invalid','',now(),now()),
  ('f9400000-0000-4000-8000-000000000002','authenticated','authenticated','pick-limit-b@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('f9400000-0000-4000-8000-000000000001','pick_limit_a',true),
  ('f9400000-0000-4000-8000-000000000002','pick_limit_b',true);
insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('f9410000-0000-4000-8000-000000000001','Pick quota','pick-quota','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status)
select
  ('f9420000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  'f9410000-0000-4000-8000-000000000001',
  'Pick item '||i,
  'pickitem'||i,
  'active'
from generate_series(1,12) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','f9400000-0000-4000-8000-000000000002',true);
insert into public.user_follows(follower_id,followee_id)
values('f9400000-0000-4000-8000-000000000002','f9400000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub','f9400000-0000-4000-8000-000000000001',true);

select lives_ok(
  $sql$
  select public.change_pick(
    'f9410000-0000-4000-8000-000000000001',
    'f9420000-0000-4000-8000-000000000001',
    'Initial Pick'
  )
  $sql$,
  'initial Pick remains free for onboarding'
);

select ok(
  not exists(
    select 1 from private.community_write_limits
    where user_id='f9400000-0000-4000-8000-000000000001'
      and action='pick'
  ),
  'initial Pick does not consume replacement quota'
);

select lives_ok(
  $sql$
  do $block$
  declare i integer;
  begin
    for i in 2..11 loop
      perform public.change_pick(
        'f9410000-0000-4000-8000-000000000001',
        ('f9420000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        'Replacement '||i
      );
    end loop;
  end
  $block$
  $sql$,
  'ten replacements per hour are allowed'
);

select throws_ok(
  $sql$
  select public.change_pick(
    'f9410000-0000-4000-8000-000000000001',
    'f9420000-0000-4000-8000-000000000012',
    'Over quota'
  )
  $sql$,
  'P0001','RATE_LIMITED',
  'eleventh replacement in one hour is rejected'
);
reset role;

select is(
  (select requests from private.community_write_limits
   where user_id='f9400000-0000-4000-8000-000000000001' and action='pick'),
  10,
  'Pick quota cannot be bypassed by replacing prior Picks'
);
select is(
  (select count(*)::integer from public.pick_change_notifications
   where recipient_id='f9400000-0000-4000-8000-000000000002'),
  1,
  'rapid changes in one category create only one follower notification'
);

update private.community_write_limits
set window_start=clock_timestamp()-interval '61 minutes'
where user_id='f9400000-0000-4000-8000-000000000001' and action='pick';
update public.pick_change_notifications
set created_at=clock_timestamp()-interval '16 minutes'
where recipient_id='f9400000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub','f9400000-0000-4000-8000-000000000001',true);
select lives_ok(
  $sql$
  select public.change_pick(
    'f9410000-0000-4000-8000-000000000001',
    'f9420000-0000-4000-8000-000000000012',
    'Window reset'
  )
  $sql$,
  'Pick replacement quota resets after one hour'
);
reset role;

select is(
  (select count(*)::integer from public.pick_change_notifications
   where recipient_id='f9400000-0000-4000-8000-000000000002'),
  2,
  'a later same-category change can notify the follower again after the dedupe window'
);
select ok(
  not has_function_privilege('authenticated','private.limit_pick_change()','execute'),
  'clients cannot invoke the quota trigger function directly'
);

select * from finish();
rollback;
