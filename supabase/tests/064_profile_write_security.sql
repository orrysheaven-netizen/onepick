begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9700000-0000-4000-8000-000000000001','authenticated','authenticated','profile-sec-a@example.invalid','',now(),now()),
  ('f9700000-0000-4000-8000-000000000002','authenticated','authenticated','profile-sec-b@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('f9700000-0000-4000-8000-000000000001','profile_sec_a',true),
  ('f9700000-0000-4000-8000-000000000002','profile_sec_b',true);

select ok(
  has_column_privilege('authenticated','public.profiles','bio','update'),
  'authenticated users retain the intended bio update privilege'
);
select ok(
  has_column_privilege('authenticated','public.profiles','profile_image_url','update'),
  'owners can point profile_image_url at their own uploaded avatar (2026-10-11)'
);
select ok(
  not has_column_privilege('authenticated','public.profiles','profile_image_url','insert'),
  'clients cannot seed an arbitrary profile image during profile creation'
);
select ok(
  not has_column_privilege('authenticated','public.profiles','created_at','update'),
  'clients cannot rewrite profile created_at'
);
select ok(
  not has_column_privilege('authenticated','public.profiles','updated_at','update'),
  'clients cannot directly rewrite profile updated_at'
);
select ok(
  not has_column_privilege('authenticated','public.profiles','id','update'),
  'clients cannot rewrite profile ownership'
);
select ok(
  not has_column_privilege('authenticated','public.profiles','created_at','insert'),
  'clients cannot forge profile created_at on insert'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9700000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);

select lives_ok(
  $$update public.profiles set bio=repeat('가',100)
    where id='f9700000-0000-4000-8000-000000000001'$$,
  '100-character bio remains valid'
);
select throws_ok(
  $$update public.profiles set bio=repeat('가',101)
    where id='f9700000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'bio longer than 100 characters is rejected by the DB'
);
select throws_ok(
  $$update public.profiles set profile_image_url='https://tracker.example/pixel.jpg'
    where id='f9700000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'client cannot PATCH an arbitrary tracking image URL (owned-avatar path only)'
);
select throws_ok(
  $$update public.profiles set created_at=clock_timestamp()
    where id='f9700000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'column privileges block direct timestamp rewrites'
);
reset role;

set local role service_role;
select throws_ok(
  $$update public.profiles set profile_image_url='https://tracker.example/pixel.jpg'
    where id='f9700000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'DB constraint rejects remote image URLs even for privileged writes'
);
reset role;

select * from finish();
rollback;
