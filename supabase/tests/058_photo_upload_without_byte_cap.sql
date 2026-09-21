begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.prokind='f'
      and p.proname in (
        'attach_item_photo_impl',
        'register_pick_impl',
        'submit_item_impl',
        'submit_unclassified_item_impl'
      )
      and (
        pg_get_functiondef(p.oid) like '%786432%'
        or pg_get_functiondef(p.oid) like '%98304%'
      )
  ),
  0,
  'item-photo write functions have no OnePick byte-size ceiling'
);

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values ('f5800000-0000-4000-8000-000000000001','authenticated','authenticated','large-photo@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed)
values ('f5800000-0000-4000-8000-000000000001','large_photo_user',true);
insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values ('f5800000-0000-4000-8000-000000000002','큰 사진 테스트','large-photo-test','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status)
values ('f5800000-0000-4000-8000-000000000003','f5800000-0000-4000-8000-000000000002','큰 사진 제품','큰사진제품','active');

insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('item-photos','f5800000-0000-4000-8000-000000000001/full.jpg','f5800000-0000-4000-8000-000000000001',
   jsonb_build_object('mimetype','image/jpeg','size',2097152)),
  ('item-photos','f5800000-0000-4000-8000-000000000001/thumb.jpg','f5800000-0000-4000-8000-000000000001',
   jsonb_build_object('mimetype','image/jpeg','size',204800));

set local role authenticated;
select set_config('request.jwt.claim.sub','f5800000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$select public.attach_item_photo(
    'f5800000-0000-4000-8000-000000000003',
    'f5800000-0000-4000-8000-000000000001/full.jpg',
    'f5800000-0000-4000-8000-000000000001/thumb.jpg'
  )$$,
  '2 MiB full image and 200 KiB thumbnail are accepted by database validation'
);

select * from finish();
rollback;
