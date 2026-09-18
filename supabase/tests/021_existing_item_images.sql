begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  author uuid := gen_random_uuid(); second_user uuid := gen_random_uuid();
  category uuid := gen_random_uuid(); blank_item uuid := gen_random_uuid(); poster_item uuid := gen_random_uuid();
  original text := author::text || '/first.jpg'; thumb text := author::text || '/first-thumb.jpg';
  second_original text := second_user::text || '/second.jpg'; second_thumb text := second_user::text || '/second-thumb.jpg';
  poster text := 'https://image.tmdb.org/t/p/w342/existing.jpg';
  result public.items%rowtype; pick public.picks%rowtype; n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[author,second_user]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'img_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[author,second_user]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(category,'Photo test','photo-'||category,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status,image_source_url) values
    (blank_item,category,'Empty photo','empty photo','active',null),
    (poster_item,category,'Existing poster','existing poster','active',poster);
  insert into storage.objects(bucket_id,name,owner_id,metadata) values
    ('item-photos',original,author::text,'{"mimetype":"image/jpeg","size":100}'::jsonb),
    ('item-photos',thumb,author::text,'{"mimetype":"image/jpeg","size":50}'::jsonb),
    ('item-photos',second_original,second_user::text,'{"mimetype":"image/jpeg","size":100}'::jsonb),
    ('item-photos',second_thumb,second_user::text,'{"mimetype":"image/jpeg","size":50}'::jsonb);
  perform set_config('request.jwt.claim.sub',author::text,true);
  set local role authenticated;
  begin
    perform public.attach_item_photo(blank_item,second_original,second_thumb);
    raise exception 'Foreign upload must fail';
  exception when raise_exception then
    if sqlerrm <> 'PHOTO_INVALID' then raise; end if;
  end;
  result := public.attach_item_photo(blank_item,original,thumb);
  assert result.image_path=original and result.thumbnail_path=thumb, 'First photo is saved';
  select count(*) into n from public.picks where item_id=blank_item;
  assert n=0, 'Contributing a photo does not register a Pick';
  result := public.attach_item_photo(poster_item,original,thumb);
  assert result.image_source_url=poster and result.image_path is null, 'Catalog poster cannot be replaced through photo RPC';
  pick := public.register_pick(category,poster_item,'Existing poster','Keep the poster',original,thumb,null);
  assert pick.item_id=poster_item, 'Legacy registration still creates a Pick';
  select * into result from public.items where id=poster_item;
  assert result.image_source_url=poster and result.image_path is null, 'Legacy registration cannot replace external image';
  reset role;
  perform set_config('request.jwt.claim.sub',second_user::text,true);
  set local role authenticated;
  result := public.attach_item_photo(blank_item,second_original,second_thumb);
  assert result.image_path=original and result.thumbnail_path=thumb, 'Later contributor receives first winner unchanged';
  result := public.attach_item_photo(poster_item,second_original,second_thumb);
  assert result.image_source_url=poster and result.image_path is null, 'Second contributor also preserves the catalog poster';
  pick := public.register_pick(category,blank_item,'Empty photo','Keep uploaded photo',second_original,second_thumb,null);
  select * into result from public.items where id=blank_item;
  assert result.image_path=original, 'Legacy registration cannot replace uploaded photo';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  begin
    perform public.attach_item_photo(blank_item,original,thumb);
    raise exception 'Anonymous call must fail';
  exception
    when insufficient_privilege then null;
    when raise_exception then if sqlerrm <> 'AUTH_REQUIRED' then raise; end if;
  end;
  reset role;
end;
$flow$;
$test$, 'First image only: source and uploaded photos preserved through all existing contribution RPCs');
select * from finish();
rollback;
