begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('fb100000-0000-4000-8000-000000000001','authenticated','authenticated','photo-a@example.invalid','',now(),now()),
  ('fb100000-0000-4000-8000-000000000002','authenticated','authenticated','photo-b@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('fb100000-0000-4000-8000-000000000001','photo_a',true),
  ('fb100000-0000-4000-8000-000000000002','photo_b',true);

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values ('fb200000-0000-4000-8000-000000000001','사진 검증','qa-photo','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status)
values
  ('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001','빈 이미지 제품','빈이미지제품','active'),
  ('fb300000-0000-4000-8000-000000000002','fb200000-0000-4000-8000-000000000001','대기 제품','대기제품','pending'),
  ('fb300000-0000-4000-8000-000000000003','fb200000-0000-4000-8000-000000000001','경로 검증 제품','경로검증제품','active');

insert into storage.objects(bucket_id,name,owner_id,metadata)
values
  ('item-photos','fb100000-0000-4000-8000-000000000001/full.jpg','fb100000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":1024}'),
  ('item-photos','fb100000-0000-4000-8000-000000000001/thumb.jpg','fb100000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":128}'),
  ('item-photos','fb100000-0000-4000-8000-000000000002/full.jpg','fb100000-0000-4000-8000-000000000002','{"mimetype":"image/jpeg","size":1024}'),
  ('item-photos','fb100000-0000-4000-8000-000000000002/thumb.jpg','fb100000-0000-4000-8000-000000000002','{"mimetype":"image/jpeg","size":128}');

select ok(
  not has_function_privilege('anon','public.attach_item_photo(uuid,text,text,text)','execute'),
  'anonymous image contribution is denied'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','fb100000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$select public.attach_item_photo(
    'fb300000-0000-4000-8000-000000000001',
    'fb100000-0000-4000-8000-000000000001/full.jpg',
    'fb100000-0000-4000-8000-000000000001/thumb.jpg'
  )$$,
  'authenticated user can fill an empty active item image'
);
-- L4: a contribution waits for admin review; the shared item stays photo-less.
select ok(
  (select image_path is null from public.items where id='fb300000-0000-4000-8000-000000000001')
  and exists(
    select 1 from public.item_photo_candidates
    where item_id='fb300000-0000-4000-8000-000000000001'
      and user_id='fb100000-0000-4000-8000-000000000001'
      and image_path='fb100000-0000-4000-8000-000000000001/full.jpg'
      and status='pending'
  ),
  'first contribution waits as a candidate, not the shared image'
);
select ok(
  not private.is_unused_item_photo('fb100000-0000-4000-8000-000000000001/full.jpg'),
  'pending contribution is protected from deletion'
);

select set_config('request.jwt.claim.sub','fb100000-0000-4000-8000-000000000002',true);
select lives_ok(
  $$select public.attach_item_photo(
    'fb300000-0000-4000-8000-000000000001',
    'fb100000-0000-4000-8000-000000000002/full.jpg',
    'fb100000-0000-4000-8000-000000000002/thumb.jpg'
  )$$,
  'later contribution is accepted as its own candidate'
);
select ok(
  (select image_path is null from public.items where id='fb300000-0000-4000-8000-000000000001')
  and (select count(*) from public.item_photo_candidates
       where item_id='fb300000-0000-4000-8000-000000000001') = 1,
  'shared image stays empty and each member sees only their own candidate'
);
select ok(
  not private.is_unused_item_photo('fb100000-0000-4000-8000-000000000002/full.jpg'),
  'later pending contribution is protected from deletion too'
);
select throws_ok(
  $$select public.attach_item_photo(
    'fb300000-0000-4000-8000-000000000002',
    'fb100000-0000-4000-8000-000000000001/full.jpg',
    'fb100000-0000-4000-8000-000000000001/thumb.jpg'
  )$$,
  'P0001','ITEM_NOT_ELIGIBLE','pending items reject direct contributions'
);
select throws_ok(
  $$select public.attach_item_photo(
    'fb300000-0000-4000-8000-000000000003',
    'fb100000-0000-4000-8000-000000000001/full.jpg',
    'fb100000-0000-4000-8000-000000000001/thumb.jpg'
  )$$,
  'P0001','PHOTO_INVALID','a user cannot attach another user upload'
);

select * from finish();
rollback;
