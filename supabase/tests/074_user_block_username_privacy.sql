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
  ('f9900000-0000-4000-8000-000000000002','visible_qa',true),
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
  'visible_qa',
  'visible target keeps the useful username snapshot'
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
  '(private)',
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
  '(private)',
  'reverse-blocked target username is not exposed by the definer trigger'
);

reset role;

-- #343: the sentinel must never be a username a real account can hold, and a
-- real @private_user must stay distinguishable from a hidden target.
select ok(
  '(private)' !~ '^[a-z0-9_]{3,20}$',
  'the hidden-target sentinel cannot match the username format'
);

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9900000-0000-4000-8000-000000000005','authenticated','authenticated','real-private@example.invalid','',now(),now());

select throws_ok(
  $$insert into public.profiles(id,username,onboarding_completed)
    values('f9900000-0000-4000-8000-000000000005','(private)',true)$$,
  '23514',
  null,
  'no profile can take the sentinel as its username'
);

insert into public.profiles(id,username,onboarding_completed) values
  ('f9900000-0000-4000-8000-000000000005','private_user',true);

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

insert into public.user_blocks(
  blocker_user_id,blocked_user_id,blocked_username_snapshot
) values(
  'f9900000-0000-4000-8000-000000000001',
  'f9900000-0000-4000-8000-000000000005',
  'ignored'
);

select is(
  (
    select blocked_username_snapshot
    from public.user_blocks
    where blocker_user_id='f9900000-0000-4000-8000-000000000001'
      and blocked_user_id='f9900000-0000-4000-8000-000000000005'
  ),
  'private_user',
  'a visible real @private_user keeps its own username'
);

select isnt(
  (
    select blocked_username_snapshot
    from public.user_blocks
    where blocker_user_id='f9900000-0000-4000-8000-000000000001'
      and blocked_user_id='f9900000-0000-4000-8000-000000000003'
  ),
  (
    select blocked_username_snapshot
    from public.user_blocks
    where blocker_user_id='f9900000-0000-4000-8000-000000000001'
      and blocked_user_id='f9900000-0000-4000-8000-000000000005'
  ),
  'a hidden target and a real @private_user are distinguishable'
);

reset role;

select * from finish();
rollback;
