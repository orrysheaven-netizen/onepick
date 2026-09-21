-- Remove OnePick's historical 768 KiB / 96 KiB byte caps from item-photo validation.
-- Images are still normalized to JPEG client-side, paths remain immutable and user-scoped,
-- and Storage's project/global limit remains the infrastructure ceiling.
--
-- Bucket-level file-size restriction must also be disabled for item-photos in Storage.
-- This migration deliberately does not write the storage schema directly.
create or replace function private.attach_item_photo_impl(
  p_item_id uuid, p_image_path text, p_thumbnail_path text,
  p_image_source_url text default null
)
returns public.items language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_item public.items%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not exists(select 1 from public.profiles where id = v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_item.status not in ('active', 'discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  -- Row lock makes the first successful image authoritative. No overwrite.
  if v_item.image_path is not null or v_item.thumbnail_path is not null
     or v_item.image_source_url is not null then return v_item; end if;
  if p_image_path is null or p_thumbnail_path is null or p_image_path = p_thumbnail_path
     or split_part(p_image_path, '/', 1) <> v_user_id::text
     or split_part(p_thumbnail_path, '/', 1) <> v_user_id::text then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  perform 1 from storage.objects where bucket_id = 'item-photos' and name = p_image_path
    and owner_id = v_user_id::text and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint,0) > 0 for share;
  if not found then raise exception 'PHOTO_INVALID' using errcode = 'P0001'; end if;
  perform 1 from storage.objects where bucket_id = 'item-photos' and name = p_thumbnail_path
    and owner_id = v_user_id::text and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint,0) > 0 for share;
  if not found then raise exception 'PHOTO_INVALID' using errcode = 'P0001'; end if;
  if p_image_source_url is not null
     and (char_length(p_image_source_url) > 2048 or p_image_source_url !~ '^https://') then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  update public.items set image_path = p_image_path, thumbnail_path = p_thumbnail_path,
    image_source_url = p_image_source_url where id = p_item_id returning * into v_item;
  return v_item;
end;
$function$;

create or replace function private.register_pick_impl(
  p_category_id uuid, p_item_id uuid, p_item_name text, p_one_line_review text,
  p_image_path text, p_thumbnail_path text, p_image_source_url text
)
returns public.picks language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if p_one_line_review is null or char_length(btrim(p_one_line_review)) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;
  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;
  if p_item_id is null then raise exception 'ITEM_SELECTION_REQUIRED' using errcode='P0001'; end if;
  select * into v_item from public.items where id=p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001'; end if;
  if v_item.status not in ('active','discontinued') then raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001'; end if;
  if v_item.image_path is null and v_item.thumbnail_path is null and v_item.image_source_url is null
     and (p_image_path is not null or p_thumbnail_path is not null) then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and coalesce((metadata->>'size')::bigint,0) > 0 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and coalesce((metadata->>'size')::bigint,0) > 0 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    update public.items set image_path=p_image_path, thumbnail_path=p_thumbnail_path,
      image_source_url=p_image_source_url where id=v_item.id;
  end if;
  -- 이 경로는 아직 구매처 링크를 받지 않는다. 링크 인자를 명시적으로 비워
  -- 넘겨, 나중에 여기에도 붙일 자리를 드러내 둔다.
  v_result := private.change_pick_impl(p_category_id,v_item.id,btrim(p_one_line_review),null,null);
  return v_result;
end;
$function$;

create or replace function private.submit_item_impl(
  p_category_id uuid,
  p_item_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='P0001';
  end if;

  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;

  select * into v_category
  from public.categories
  where id=p_category_id;

  if not found or not private.category_accepts_picks(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := private.canonical_item_name(p_item_name,v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;

  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  perform pg_advisory_xact_lock(
    hashtextextended('item:'||p_category_id::text||':'||v_normalized,0)
  );

  select * into v_item
  from public.items
  where category_id=p_category_id
    and normalized_name=v_normalized
    and (
      status in ('active','discontinued')
      or (status='pending' and created_by=v_user)
    )
  order by
    case status when 'active' then 0 when 'discontinued' then 1 else 2 end,
    created_at,
    id
  limit 1
  for update;

  if found then
    return v_item;
  end if;

  if exists (
    select 1
    from public.items
    where category_id=p_category_id
      and normalized_name=v_normalized
      and status='pending'
  ) then
    raise exception 'ITEM_ALREADY_PENDING' using errcode='P0001';
  end if;

  if (
    select count(*)
    from public.items
    where created_by=v_user
      and created_at>now()-interval '1 day'
  ) >= 20 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;

  if p_image_path is not null or p_thumbnail_path is not null then
    if p_image_path is null
       or p_thumbnail_path is null
       or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text
       or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    perform 1
    from storage.objects
    where bucket_id='item-photos'
      and name=p_image_path
      and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and coalesce((metadata->>'size')::bigint,0) > 0
    for share;
    if not found then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    perform 1
    from storage.objects
    where bucket_id='item-photos'
      and name=p_thumbnail_path
      and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and coalesce((metadata->>'size')::bigint,0) > 0
    for share;
    if not found then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    if p_image_source_url is not null
       and (
         char_length(p_image_source_url)>2048
         or p_image_source_url !~ '^https://'
       ) then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
  end if;

  insert into public.items(
    category_id,
    name,
    normalized_name,
    status,
    created_by,
    image_path,
    thumbnail_path,
    image_source_url
  ) values (
    p_category_id,
    v_name,
    v_normalized,
    'pending',
    v_user,
    p_image_path,
    p_thumbnail_path,
    p_image_source_url
  )
  returning * into v_item;

  return v_item;
end;
$function$;

create or replace function private.submit_unclassified_item_impl(
  p_item_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_category_id uuid;
  v_name text;
  v_normalized text;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='P0001';
  end if;
  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;

  select id into v_category_id
  from public.categories
  where slug='pending-product'
    and status='open'
    and is_visible=false
    and is_pickable=false;

  if v_category_id is null then
    raise exception 'CATEGORY_NOT_FOUND' using errcode='P0001';
  end if;

  v_name := btrim(regexp_replace(coalesce(p_item_name,''),'[[:space:]]+',' ','g'));
  if char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  perform pg_advisory_xact_lock(
    hashtextextended('unclassified-item:'||v_user::text||':'||v_normalized,0)
  );

  select * into v_item
  from public.items
  where category_id=v_category_id
    and normalized_name=v_normalized
    and status='pending'
    and created_by=v_user
  order by created_at,id
  limit 1
  for update;

  if found then return v_item; end if;

  if (select count(*) from public.items
      where created_by=v_user and created_at>now()-interval '1 day')>=20 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;

  if p_image_path is not null or p_thumbnail_path is not null then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text
       or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and coalesce((metadata->>'size')::bigint,0) > 0
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and coalesce((metadata->>'size')::bigint,0) > 0
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    if p_image_source_url is not null
       and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
  end if;

  insert into public.items(
    category_id,name,normalized_name,status,created_by,
    image_path,thumbnail_path,image_source_url
  ) values (
    v_category_id,v_name,v_normalized,'pending',v_user,
    p_image_path,p_thumbnail_path,p_image_source_url
  )
  returning * into v_item;

  return v_item;
end;
$$;
