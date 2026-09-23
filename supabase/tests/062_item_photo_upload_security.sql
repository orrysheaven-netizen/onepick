begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values('f9500000-0000-4000-8000-000000000001','authenticated','authenticated',
  'photo-quota@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed)
values('f9500000-0000-4000-8000-000000000001','photo_quota_user',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','f9500000-0000-4000-8000-000000000001',true);

select ok(
  (select bool_and(private.can_upload_item_photo()) from generate_series(1,20)),
  'first twenty photo uploads in a 24-hour window are allowed'
);
select ok(
  not private.can_upload_item_photo(),
  'twenty-first upload is denied even without relying on existing Storage rows'
);
reset role;

select is(
  (select uploads from private.item_photo_upload_limits
   where user_id='f9500000-0000-4000-8000-000000000001'),
  20,
  'immutable quota counter records successful upload admissions'
);
update private.item_photo_upload_limits
set window_start=clock_timestamp()-interval '25 hours'
where user_id='f9500000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','f9500000-0000-4000-8000-000000000001',true);
select ok(private.can_upload_item_photo(),'photo quota resets after 24 hours');
reset role;

select ok(
  not has_table_privilege('authenticated','private.item_photo_upload_limits','select'),
  'clients cannot inspect or reset photo quota counters'
);
select ok(
  not has_function_privilege('authenticated','public.claim_item_photo_cleanup()','execute'),
  'clients cannot claim the maintenance lease'
);
select ok(
  not has_function_privilege('authenticated','public.stale_item_photo_paths(integer)','execute'),
  'clients cannot enumerate stale object paths'
);

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('f9510000-0000-4000-8000-000000000001','Photo cleanup','photo-cleanup','open',true,true);
insert into public.items(id,category_id,name,normalized_name,status,image_path)
values(
  'f9520000-0000-4000-8000-000000000001',
  'f9510000-0000-4000-8000-000000000001',
  'Referenced photo item','referencedphotoitem','active',
  'f9500000-0000-4000-8000-000000000001/referenced.jpg'
);
insert into storage.objects(bucket_id,name,owner_id,created_at,updated_at,metadata) values
(
  'item-photos','f9500000-0000-4000-8000-000000000001/referenced.jpg',
  'f9500000-0000-4000-8000-000000000001',
  clock_timestamp()-interval '25 hours',clock_timestamp()-interval '25 hours',
  '{"mimetype":"image/jpeg","size":100}'::jsonb
),
(
  'item-photos','f9500000-0000-4000-8000-000000000001/stale.jpg',
  'f9500000-0000-4000-8000-000000000001',
  clock_timestamp()-interval '25 hours',clock_timestamp()-interval '25 hours',
  '{"mimetype":"image/jpeg","size":100}'::jsonb
);

set local role service_role;
select is(
  (select count(*)::integer from public.stale_item_photo_paths(100)),
  1,
  'only stale unreferenced objects are selected for Storage API cleanup'
);
select is(
  (select path from public.stale_item_photo_paths(100)),
  'f9500000-0000-4000-8000-000000000001/stale.jpg',
  'referenced representative images are never cleanup candidates'
);
select ok(public.claim_item_photo_cleanup(),'first daily cleanup lease is granted');
select ok(not public.claim_item_photo_cleanup(),'a second cleanup within 23 hours is skipped');
reset role;

select ok(
  exists(select 1 from cron.job where jobname='onepick-item-photo-cleanup'),
  'daily stale-photo cleanup job is scheduled'
);

select * from finish();
rollback;
