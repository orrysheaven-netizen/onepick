begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  uploader uuid := gen_random_uuid(); later_user uuid := gen_random_uuid(); creator uuid := gen_random_uuid();
  category uuid := gen_random_uuid(); target uuid := gen_random_uuid(); legacy_target uuid := gen_random_uuid();
  poster_target uuid := gen_random_uuid(); unknown_target uuid := gen_random_uuid();
  full_a text := uploader::text||'/credit-full.jpg'; thumb_a text := uploader::text||'/credit-thumb.jpg';
  full_b text := later_user::text||'/credit-full.jpg'; thumb_b text := later_user::text||'/credit-thumb.jpg';
  -- Distinct items require distinct object paths; keep the existing unique-image constraint.
  legacy_full text := uploader::text||'/legacy-full.jpg'; legacy_thumb text := uploader::text||'/legacy-thumb.jpg';
  poster text := 'https://image.tmdb.org/t/p/w342/credit-test.jpg';
  row_item public.items%rowtype; n integer; credited uuid; credited_name text;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[uploader,later_user,creator]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'credit_'||substr(replace(id::text,'-',''),1,10),true from unnest(array[uploader,later_user,creator]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(category,'Credit test','credit-'||category,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status,created_by,image_path,thumbnail_path,image_source_url) values
    (target,category,'Credit target','credit target','active',creator,null,null,null),
    (legacy_target,category,'Legacy target','legacy target','active',creator,null,null,null),
    (poster_target,category,'Poster target','poster target','active',creator,null,null,poster),
    (unknown_target,category,'Unknown author','unknown author','active',uploader,'unknown/full.jpg','unknown/thumb.jpg',null);
  select count(*) into n from public.item_photo_credits where item_id in(target,poster_target,unknown_target);
  assert n=0, 'No guesses from item creator, external posters or unknown objects';
  insert into storage.objects(bucket_id,name,owner_id,metadata) values
    ('item-photos',full_a,uploader::text,'{"mimetype":"image/jpeg","size":100}'::jsonb),
    ('item-photos',thumb_a,uploader::text,'{"mimetype":"image/jpeg","size":50}'::jsonb),
    ('item-photos',full_b,later_user::text,'{"mimetype":"image/jpeg","size":100}'::jsonb),
    ('item-photos',thumb_b,later_user::text,'{"mimetype":"image/jpeg","size":50}'::jsonb),
    ('item-photos',legacy_full,uploader::text,'{"mimetype":"image/jpeg","size":100}'::jsonb),
    ('item-photos',legacy_thumb,uploader::text,'{"mimetype":"image/jpeg","size":50}'::jsonb);
  perform set_config('request.jwt.claim.sub',uploader::text,true);
  set local role authenticated;
  row_item := public.attach_item_photo(target,full_a,thumb_a);
  select c.user_id into credited from public.item_photo_credit(target) c;
  assert credited=uploader and credited<>creator, 'Credit belongs to stored-photo owner, not product creator';
  select count(*) into n from public.picks where item_id=target;
  assert n=0, 'Photo contribution alone creates no Pick';
  perform public.register_pick(category,legacy_target,'Legacy target','My reason',legacy_full,legacy_thumb,null);
  select c.user_id into credited from public.item_photo_credit(legacy_target) c;
  assert credited=uploader, 'Existing registration also records verified photo ownership';
  begin
    update public.item_photo_credits set user_id=later_user where item_id=target;
    raise exception 'Client forged credit';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.item_photo_credits where item_id=target;
    raise exception 'Client removed credit';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.item_photo_credits(item_id,user_id,image_path,thumbnail_path)
      values(poster_target,uploader,full_a,thumb_a);
    raise exception 'Client invented credit';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub',later_user::text,true);
  set local role authenticated;
  row_item := public.attach_item_photo(target,full_b,thumb_b);
  assert row_item.image_path=full_a, 'First image remains in concurrent/late contribution flow';
  select c.user_id into credited from public.item_photo_credit(target) c;
  assert credited=uploader, 'Losing contributor cannot replace winning credit';
  row_item := public.attach_item_photo(poster_target,full_b,thumb_b);
  select count(*) into n from public.item_photo_credit(poster_target);
  assert n=0, 'External poster has no fabricated user credit';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(later_user,uploader,'credit_test');
  select count(*) into n from public.item_photo_credit(target);
  assert n=0, 'Blocked contributor is hidden from the viewer';
  delete from public.user_blocks where blocker_user_id=later_user and blocked_user_id=uploader;
  reset role;
  perform set_config('request.jwt.claim.sub',uploader::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(uploader,later_user,'credit_test');
  reset role;
  perform set_config('request.jwt.claim.sub',later_user::text,true);
  set local role authenticated;
  select count(*) into n from public.item_photo_credit(target);
  assert n=0, 'Reverse block also hides contributor';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.item_photo_credit(target);
  assert n=1, 'Unblocked anonymous visitors may see public credit';
  reset role;
  update public.profiles set username='renamed_'||substr(replace(uploader::text,'-',''),1,8) where id=uploader;
  set local role anon;
  select c.username into credited_name from public.item_photo_credit(target) c;
  assert credited_name='renamed_'||substr(replace(uploader::text,'-',''),1,8), 'Credit links follow current username';
  reset role;
  insert into private.user_moderation(user_id,reason) values(uploader,'Synthetic credit test');
  set local role anon;
  select count(*) into n from public.item_photo_credit(target);
  assert n=0, 'Suspended contributor is not promoted';
  reset role;
  delete from private.user_moderation where user_id=uploader;
  update public.items set image_path=full_b,thumbnail_path=thumb_b where id=target;
  select user_id into credited from public.item_photo_credits where item_id=target;
  assert credited=later_user, 'An administrative replacement follows the actual new object owner';
  update public.items set status='hidden' where id=target;
  set local role anon;
  select count(*) into n from public.item_photo_credit(target);
  assert n=0, 'Hidden item credit is not readable';
  reset role;
  update public.items set image_path=null,thumbnail_path=null,image_source_url=poster where id=target;
  select count(*) into n from public.item_photo_credits where item_id=target;
  assert n=0, 'Removing/replacing an upload with a poster clears old attribution';
  delete from public.profiles where id=uploader;
  select count(*) into n from public.item_photo_credits where item_id=legacy_target;
  assert n=0, 'Account deletion removes its credit';
  select count(*) into n from public.items where id=legacy_target and image_path=legacy_full;
  assert n=1, 'Removing a profile credit does not delete the shared item';
  assert not (select prosecdef from pg_proc where oid='public.item_photo_credit(uuid)'::regprocedure), 'Credit reads retain caller RLS';
  assert not has_table_privilege('authenticated','public.item_photo_credits','INSERT'), 'No direct user credit writes';
end;
$flow$;
$test$, 'Photo credits: real image owner, first-winner, no false attribution, read-only client, replacement, blocks, suspension and deletion');
select * from finish();
rollback;
