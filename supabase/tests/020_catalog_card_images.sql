begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($flow$
do $test$
#variable_conflict use_variable
declare
  source_user uuid := gen_random_uuid(); upload_user uuid := gen_random_uuid(); missing_user uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid(); source_item uuid := gen_random_uuid(); upload_item uuid := gen_random_uuid(); missing_item uuid := gen_random_uuid();
  poster text := 'https://image.tmdb.org/t/p/w342/card-regression.jpg';
  r record; j jsonb; n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[source_user,upload_user,missing_user]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'photo_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[source_user,upload_user,missing_user]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(category_id,'Image regression','image-'||category_id,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status,image_path,thumbnail_path,image_source_url) values
    (source_item,category_id,'Source-only movie','source movie','active',null,null,poster),
    (upload_item,category_id,'Uploaded photo','uploaded photo','active','fixture/original.jpg','fixture/thumb.jpg',poster),
    (missing_item,category_id,'No photo','no photo','active',null,null,null);
  insert into public.picks(user_id,category_id,item_id,one_line_review,status) values
    (source_user,category_id,source_item,'source photo test','active'),
    (upload_user,category_id,upload_item,'upload photo test','active'),
    (missing_user,category_id,missing_item,'missing photo test','active');
  update public.home_settings set minimum_pick_count=1 where id;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select * into r from public.category_top_items(category_id) q where q.item_id=source_item;
  assert found and r.image_source_url=poster and r.thumbnail_path is null and r.image_path is null, 'TOP 3 returns external poster separately from storage paths';
  assert r.pick_count=1 and r.rank=1 and r.is_tied, 'Counts and ties unchanged';
  select * into r from public.category_top_items(category_id) q where q.item_id=upload_item;
  assert r.thumbnail_path='fixture/thumb.jpg' and r.image_path='fixture/original.jpg' and r.image_source_url=poster, 'All image candidates returned';
  select * into r from public.category_top_items(category_id) q where q.item_id=missing_item;
  assert r.thumbnail_path is null and r.image_path is null and r.image_source_url is null, 'Missing photos stay null';
  select e into j from public.home_showcase_page() h cross join lateral jsonb_array_elements(h.items) e where e->>'item_id'=source_item::text;
  assert j->>'image_source_url'=poster, 'Paged home returns poster';
  assert j->>'latest_picker_username' is not null and j->>'last_picked_at' is not null, 'Profile and cursor metadata retained';
  select e into j from public.home_showcase() h cross join lateral jsonb_array_elements(h.items) e where e->>'item_id'=source_item::text;
  assert j->>'image_source_url'=poster, 'Legacy home returns poster';
  reset role;
  perform set_config('request.jwt.claim.sub',upload_user::text,true);
  set local role authenticated;
  select * into r from public.category_top_items(category_id) q where q.item_id=upload_item;
  assert r.thumbnail_path='fixture/thumb.jpg' and r.image_source_url=poster, 'Signed-in callers receive image metadata';
  reset role;
  insert into private.user_moderation(user_id,reason) values(source_user,'Synthetic image regression');
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.category_top_items(category_id) q where q.item_id=source_item;
  assert n=0, 'Suspension privacy in ranking';
  select count(*) into n from public.home_showcase_page() h cross join lateral jsonb_array_elements(h.items) e where e->>'item_id'=source_item::text;
  assert n=0, 'Suspension privacy in home';
  reset role;
  assert not (select prosecdef from pg_proc where oid='public.category_top_items(uuid,text)'::regprocedure), 'Ranking remains SECURITY INVOKER';
end;
$test$;
$flow$, 'Catalog card image metadata, stable rankings, home profile/cursor and RLS');
select * from finish();
rollback;
