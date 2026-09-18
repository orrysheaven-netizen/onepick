begin;

create or replace function private.attach_item_photo_impl(
  p_item_id uuid,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text default null
)
returns public.items
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.items%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists(select 1 from public.profiles where id = v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_item.status not in ('active', 'discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  -- The first valid contribution wins. A concurrent loser receives the
  -- current row and can safely remove its now-unused immutable upload.
  if v_item.image_path is not null then
    return v_item;
  end if;

  if p_image_path is null
     or p_thumbnail_path is null
     or p_image_path = p_thumbnail_path
     or split_part(p_image_path, '/', 1) <> v_user_id::text
     or split_part(p_thumbnail_path, '/', 1) <> v_user_id::text then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  perform 1
  from storage.objects
  where bucket_id = 'item-photos'
    and name = p_image_path
    and owner_id = v_user_id::text
    and metadata->>'mimetype' = 'image/jpeg'
    and (metadata->>'size')::bigint between 1 and 786432
  for share;
  if not found then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  perform 1
  from storage.objects
  where bucket_id = 'item-photos'
    and name = p_thumbnail_path
    and owner_id = v_user_id::text
    and metadata->>'mimetype' = 'image/jpeg'
    and (metadata->>'size')::bigint between 1 and 98304
  for share;
  if not found then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  if p_image_source_url is not null
     and (char_length(p_image_source_url) > 2048 or p_image_source_url !~ '^https://') then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  update public.items
  set image_path = p_image_path,
      thumbnail_path = p_thumbnail_path,
      image_source_url = p_image_source_url
  where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.attach_item_photo(
  p_item_id uuid,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text default null
)
returns public.items
language sql
set search_path to ''
as $$
  select private.attach_item_photo_impl(
    p_item_id,
    p_image_path,
    p_thumbnail_path,
    p_image_source_url
  );
$$;

revoke all on function private.attach_item_photo_impl(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function private.attach_item_photo_impl(uuid,text,text,text)
  to authenticated;

revoke all on function public.attach_item_photo(uuid,text,text,text)
  from public, anon;
grant execute on function public.attach_item_photo(uuid,text,text,text)
  to authenticated, service_role;

commit;
