begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9600000-0000-4000-8000-000000000001','authenticated','authenticated','photo-suspended@example.invalid','',now(),now()),
  ('f9600000-0000-4000-8000-000000000002','authenticated','authenticated','photo-admin@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('f9600000-0000-4000-8000-000000000001','photo_suspended',true),
  ('f9600000-0000-4000-8000-000000000002','photo_admin',true);
insert into private.admin_users(user_id)
values('f9600000-0000-4000-8000-000000000002');
insert into private.user_moderation(user_id,reason,suspended_by)
values(
  'f9600000-0000-4000-8000-000000000001',
  'security fixture',
  'f9600000-0000-4000-8000-000000000002'
);

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('f9610000-0000-4000-8000-000000000001','Photo moderation','photo-moderation','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status) values
  ('f9620000-0000-4000-8000-000000000001','f9610000-0000-4000-8000-000000000001','Photo target','phototarget','active'),
  ('f9620000-0000-4000-8000-000000000002','f9610000-0000-4000-8000-000000000001','Registration target','registrationtarget','active');

insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('item-photos','f9600000-0000-4000-8000-000000000001/full.jpg','f9600000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":100}'::jsonb),
  ('item-photos','f9600000-0000-4000-8000-000000000001/thumb.jpg','f9600000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":50}'::jsonb);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9600000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);

select throws_ok(
  $sql$
  select public.attach_item_photo(
    'f9620000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001/full.jpg',
    'f9600000-0000-4000-8000-000000000001/thumb.jpg'
  )
  $sql$,
  'P0001','ACCOUNT_SUSPENDED',
  'suspended user cannot claim an active item representative image'
);

select throws_ok(
  $sql$
  select public.register_pick(
    'f9610000-0000-4000-8000-000000000001',
    'f9620000-0000-4000-8000-000000000002',
    'Registration target',
    'Suspended registration',
    'f9600000-0000-4000-8000-000000000001/full.jpg',
    'f9600000-0000-4000-8000-000000000001/thumb.jpg',
    null
  )
  $sql$,
  'P0001','ACCOUNT_SUSPENDED',
  'legacy register-pick photo adoption is blocked for suspended users'
);

select throws_ok(
  $sql$
  select public.admin_replace_item_photo(
    'f9620000-0000-4000-8000-000000000001',
    null,null,null
  )
  $sql$,
  '42501','ADMIN_MFA_REQUIRED',
  'non-admin cannot use the representative-image moderation RPC'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9600000-0000-4000-8000-000000000002',
    'role','authenticated',
    'aal','aal2'
  )::text,
  true
);

select lives_ok(
  $sql$
  select public.admin_replace_item_photo(
    'f9620000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001/full.jpg',
    'f9600000-0000-4000-8000-000000000001/thumb.jpg',
    null
  )
  $sql$,
  'MFA admin can deliberately approve/replace a representative image'
);
select is(
  (select image_path from public.items where id='f9620000-0000-4000-8000-000000000001'),
  'f9600000-0000-4000-8000-000000000001/full.jpg',
  'admin-selected image becomes representative'
);
select lives_ok(
  $sql$
  select public.admin_replace_item_photo(
    'f9620000-0000-4000-8000-000000000001',
    null,null,null
  )
  $sql$,
  'MFA admin can remove an inappropriate representative image'
);
select is(
  (select image_path from public.items where id='f9620000-0000-4000-8000-000000000001'),
  null,
  'admin removal clears representative image'
);
reset role;

select ok(
  not has_function_privilege('anon','public.admin_replace_item_photo(uuid,text,text,text)','execute'),
  'anonymous callers cannot invoke the moderation RPC'
);

select * from finish();
rollback;
