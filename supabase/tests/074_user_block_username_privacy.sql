begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9900000-0000-4000-8000-000000000001','authenticated','authenticated','blocker@example.invalid','',now(),now()),
  ('f9900000-0000-4000-8000-000000000002','authenticated','authenticated','visible@example.invalid','',now(),now()),
  ('f9900000-0000-4000-8000-000000000003','authenticated','authenticated','suspended-target@example.invalid','',now(),now()),
  ('f9900000-0000-4000-8000-000000000004','authenticated','authenticated','reverse-block@example.invalid','',now(),now());

insert into public.profiles(id,username,onboarding_completed) values
  ('f9900000-0000-4000-8000-000000000001','blocker_qa',true),
  ('f9900000-0000-4000-8000-000000000002','private_user',true),
  ('f9900000-0000-4000-8000-000000000003','suspended_qa',true),
  ('f9900000-0000-4000-8000-000000000004','reverse_qa',true);

insert into private.user_moderation(user_id,reason,suspended_at)
values(
  'f9900000-0000-4000-8000-000000000003',
  'Security QA hidden username fixture',
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9900000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9900000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$insert into public.user_blocks(
      blocker_user_id,blocked_user_id,blocked_username_snapshot
    ) values(
      'f9900000-0000-4000-8000-000000000001',
      'f9900000-0000-4000-8000-000000000002',
      'ignored'
    )$$,
  'a visible target can still be blocked'
);

select is(
  (
    select blocked_username_snapshot
    from public.user_blocks
    where blocker_user_id='f9900000-0000-4000-8000-000000000001'
      and blocked_user_id='f9900000-0000-4000-8000-000000000002'
  ),
  'private_user',
  'a legitimate private_user username stays distinguishable from the hidden sentinel'
);

select lives_ok(
  $$insert into public.user_blocks(
      blocker_user_id,blocked_user_id,blocked_username_snapshot
    ) values(
      'f9900000-0000-4000-8000-000000000001',
      'f9900000-0000-4000-8000-000000000003',
      'ignored'
    )$$,
  'a suspended target can still be blocked by known id'
);

select is(
  (
    select blocked_username_snapshot
    from public.user_blocks
    where blocker_user_id='f9900000-0000-4000-8000-000000000001'
      and blocked_user_id='f9900000-0000-4000-8000-000000000003'
  ),
  'private-user',
  'suspended target username is not copied into the snapshot'
);

reset role;

-- Create the opposite direction first. That relationship makes reverse_qa
-- hidden from blocker_qa under the normal authenticated profile policy.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9900000-0000-4000-8000-000000000004',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9900000-0000-4000-8000-000000000004',true);

insert into public.user_blocks(
  blocker_user_id,blocked_user_id,blocked_username_snapshot
) values(
  'f9900000-0000-4000-8000-000000000004',
  'f9900000-0000-4000-8000-000000000001',
  'ignored'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9900000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9900000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$insert into public.user_blocks(
      blocker_user_id,blocked_user_id,blocked_username_snapshot
    ) values(
      'f9900000-0000-4000-8000-000000000001',
      'f9900000-0000-4000-8000-000000000004',
      'ignored'
    )$$,
  'a target hidden by an existing reverse block can still be blocked'
);

select is(
  (
    select blocked_username_snapshot
    from public.user_blocks
    where blocker_user_id='f9900000-0000-4000-8000-000000000001'
      and blocked_user_id='f9900000-0000-4000-8000-000000000004'
  ),
  'private-user',
  'reverse-blocked target username is not exposed by the definer trigger'
);

reset role;

select ok(
  'private-user' !~ '^[a-z0-9_]{3,20}
rollback;
,
  'hidden block sentinel cannot collide with a valid profile username'
);

select * from finish();
rollback;
