begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- a: owner, b: another member, s: suspended member, m: moderator fixture
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('fa300000-0000-4000-8000-000000000001','authenticated','authenticated','avatar-a@example.invalid','',now(),now()),
  ('fa300000-0000-4000-8000-000000000002','authenticated','authenticated','avatar-b@example.invalid','',now(),now()),
  ('fa300000-0000-4000-8000-000000000003','authenticated','authenticated','avatar-s@example.invalid','',now(),now()),
  ('fa300000-0000-4000-8000-000000000004','authenticated','authenticated','avatar-m@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('fa300000-0000-4000-8000-000000000001','avatar_a',true),
  ('fa300000-0000-4000-8000-000000000002','avatar_b',true),
  ('fa300000-0000-4000-8000-000000000003','avatar_s',true),
  ('fa300000-0000-4000-8000-000000000004','avatar_m',true);
insert into private.admin_users(user_id) values('fa300000-0000-4000-8000-000000000004');
insert into private.user_moderation(user_id,reason,suspended_by)
values('fa300000-0000-4000-8000-000000000003','avatar fixture','fa300000-0000-4000-8000-000000000004');

select is((select public from storage.buckets where id='profile-avatars'), true, 'avatar bucket is public-read');
select is((select file_size_limit from storage.buckets where id='profile-avatars'), 524288::bigint, 'avatar bucket is capped at 512KiB');
select is((select allowed_mime_types from storage.buckets where id='profile-avatars'), array['image/jpeg'], 'avatar bucket only accepts JPEG');
select ok(has_column_privilege('authenticated','public.profiles','profile_image_url','UPDATE'), 'owner edit privilege');
select ok(not has_column_privilege('authenticated','public.profiles','profile_image_url','INSERT'), 'signup allowlist unchanged');
select ok(not has_column_privilege('anon','public.profiles','profile_image_url','UPDATE'), 'anon cannot write');
select ok(not has_table_privilege('authenticated','public.profiles','UPDATE'), 'no table-wide UPDATE');

-- ---- owner a uploads into their own folder ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa300000-0000-4000-8000-000000000001',true);

select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/one.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}')$$,
  'owner can upload into their own folder');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000002/forged.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}')$$,
  '42501', null, 'owner cannot upload into another member''s folder');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/one.png','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}')$$,
  '42501', null, 'only .jpg names are accepted');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/a/b.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}')$$,
  '42501', null, 'no nested folders');

select lives_ok($$update public.profiles set profile_image_url='fa300000-0000-4000-8000-000000000001/one.jpg'
  where id='fa300000-0000-4000-8000-000000000001'$$, 'owner points the profile at the uploaded photo');
select is((select profile_image_url from public.profiles where id='fa300000-0000-4000-8000-000000000001'),
  'fa300000-0000-4000-8000-000000000001/one.jpg', 'path round-trips');
select throws_ok($$update public.profiles set profile_image_url='fa300000-0000-4000-8000-000000000001/missing.jpg'
  where id='fa300000-0000-4000-8000-000000000001'$$, 'P0001', 'PROFILE_AVATAR_NOT_FOUND', 'a path without an uploaded object is rejected');
select throws_ok($$update public.profiles set profile_image_url='https://tracker.example/pixel.jpg'
  where id='fa300000-0000-4000-8000-000000000001'$$, '23514', null, 'remote URLs are rejected');
with changed as (update public.profiles set profile_image_url=null where id='fa300000-0000-4000-8000-000000000002' returning id)
select is((select count(*)::integer from changed), 0, 'another member''s photo cannot be edited');

-- The current photo cannot be deleted; a replaced one can.
-- The Storage API sets this before deleting; direct SQL deletes are blocked otherwise.
select set_config('storage.allow_delete_query','true',true);
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/two.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}')$$,
  'second upload for a replacement');
with gone as (delete from storage.objects where bucket_id='profile-avatars' and name='fa300000-0000-4000-8000-000000000001/one.jpg' returning 1)
select is((select count(*)::integer from gone), 0, 'the photo in use cannot be deleted');
select lives_ok($$update public.profiles set profile_image_url='fa300000-0000-4000-8000-000000000001/two.jpg'
  where id='fa300000-0000-4000-8000-000000000001'$$, 'owner switches to the new photo');
with gone as (delete from storage.objects where bucket_id='profile-avatars' and name='fa300000-0000-4000-8000-000000000001/one.jpg' returning 1)
select is((select count(*)::integer from gone), 1, 'the replaced photo can be deleted');

-- Per-member cap: at most three objects at once.
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/three.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}'),
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/four.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}')$$,
  'up to three objects');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/five.jpg','fa300000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}')$$,
  '42501', null, 'a fourth object is refused');

select lives_ok($$update public.profiles set profile_image_url=null where id='fa300000-0000-4000-8000-000000000001'$$,
  'owner can remove their photo');
reset role;

-- ---- another member cannot delete a's objects -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa300000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa300000-0000-4000-8000-000000000002',true);
with gone as (delete from storage.objects where bucket_id='profile-avatars' and owner_id='fa300000-0000-4000-8000-000000000001' returning 1)
select is((select count(*)::integer from gone), 0, 'members cannot delete other members'' photos');
select throws_ok($$update public.profiles set profile_image_url='fa300000-0000-4000-8000-000000000001/two.jpg'
  where id='fa300000-0000-4000-8000-000000000002'$$, '23514', null, 'a member cannot point at another member''s photo');
reset role;

-- ---- suspended member -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa300000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa300000-0000-4000-8000-000000000003',true);
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000003/s.jpg','fa300000-0000-4000-8000-000000000003','{"mimetype":"image/jpeg","size":100}')$$,
  '42501', null, 'suspended members cannot upload');
reset role;

-- ---- anon -------------------------------------------------------------------------
set local role anon;
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('profile-avatars','fa300000-0000-4000-8000-000000000001/anon.jpg',null,'{"mimetype":"image/jpeg","size":100}')$$,
  '42501', null, 'anon cannot upload');
reset role;

select * from finish();
rollback;
