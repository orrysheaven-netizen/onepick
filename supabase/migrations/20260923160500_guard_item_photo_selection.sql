-- Prevent suspended users from becoming the first representative-photo setter,
-- and give MFA-stepped-up admins an explicit repair path.

create or replace function private.guard_first_item_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return new;
  end if;

  if old.image_path is null
     and old.thumbnail_path is null
     and old.image_source_url is null
     and (new.image_path is not null
       or new.thumbnail_path is not null
       or new.image_source_url is not null)
     and private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_first_item_photo() from public, anon;
grant execute on function private.guard_first_item_photo() to authenticated, service_role;

drop trigger if exists items_guard_first_photo on public.items;
create trigger items_guard_first_photo
before update of image_path, thumbnail_path, image_source_url on public.items
for each row execute function private.guard_first_item_photo();

create or replace function public.admin_replace_item_photo(
  p_item_id uuid,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = 'P0001';
  end if;

  if p_image_path is null
     or p_thumbnail_path is null
     or p_image_path = p_thumbnail_path then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  perform 1
  from storage.objects
  where bucket_id = 'item-photos'
    and name = p_image_path
    and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint, 0) > 0;
  if not found then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  perform 1
  from storage.objects
  where bucket_id = 'item-photos'
    and name = p_thumbnail_path
    and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint, 0) > 0;
  if not found then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  if p_image_source_url is not null
     and (char_length(p_image_source_url) > 2048
       or p_image_source_url !~ '^https://') then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;

  update public.items
  set image_path = p_image_path,
      thumbnail_path = p_thumbnail_path,
      image_source_url = p_image_source_url
  where id = p_item_id
    and status in ('active','discontinued')
  returning * into v_item;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_item;
end;
$$;

revoke all on function public.admin_replace_item_photo(uuid,text,text,text)
  from public, anon;
grant execute on function public.admin_replace_item_photo(uuid,text,text,text)
  to authenticated, service_role;
