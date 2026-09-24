-- Security QA #225 item 7: suspended users must not choose a shared
-- item's representative image, and MFA admins need an explicit replacement path.

create or replace function private.guard_item_photo_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return new;
  end if;

  if tg_op='UPDATE'
     and (new.image_path,new.thumbnail_path,new.image_source_url)
       is not distinct from (old.image_path,old.thumbnail_path,old.image_source_url) then
    return new;
  end if;

  if new.image_path is null
     and new.thumbnail_path is null
     and new.image_source_url is null then
    return new;
  end if;

  if private.is_user_suspended(v_actor)
     and not private.is_admin_mfa() then
    raise exception 'ACCOUNT_SUSPENDED' using errcode='P0001';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_item_photo_actor() from public,anon,authenticated;

drop trigger if exists items_guard_photo_actor on public.items;
create trigger items_guard_photo_actor
before insert or update of image_path,thumbnail_path,image_source_url
on public.items
for each row execute function private.guard_item_photo_actor();

create or replace function public.admin_replace_item_photo(
  p_item_id uuid,
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
  v_item public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  if p_image_path is null and p_thumbnail_path is null then
    if p_image_source_url is not null
       and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
  else
    if p_image_path is null
       or p_thumbnail_path is null
       or p_image_path=p_thumbnail_path then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    perform 1
    from storage.objects original
    join storage.objects thumb
      on thumb.bucket_id='item-photos'
     and thumb.name=p_thumbnail_path
     and thumb.owner_id=original.owner_id
    where original.bucket_id='item-photos'
      and original.name=p_image_path
      and original.metadata->>'mimetype'='image/jpeg'
      and thumb.metadata->>'mimetype'='image/jpeg'
      and coalesce((original.metadata->>'size')::bigint,0)>0
      and coalesce((thumb.metadata->>'size')::bigint,0)>0;
    if not found then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    if p_image_source_url is not null
       and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
  end if;

  update public.items
  set image_path=p_image_path,
      thumbnail_path=p_thumbnail_path,
      image_source_url=p_image_source_url,
      updated_at=clock_timestamp()
  where id=p_item_id
  returning * into v_item;

  return v_item;
end;
$function$;

revoke all on function public.admin_replace_item_photo(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.admin_replace_item_photo(uuid,text,text,text)
  to authenticated;
