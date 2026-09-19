-- A catalog poster is already a photo. All ordinary contribution entry points
-- preserve it, including legacy register_pick clients and concurrent requests.
-- This migration changes no stored items, policies, storage permissions or grants.
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
    and (metadata->>'size')::bigint between 1 and 786432 for share;
  if not found then raise exception 'PHOTO_INVALID' using errcode = 'P0001'; end if;
  perform 1 from storage.objects where bucket_id = 'item-photos' and name = p_thumbnail_path
    and owner_id = v_user_id::text and metadata->>'mimetype' = 'image/jpeg'
    and (metadata->>'size')::bigint between 1 and 98304 for share;
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
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 786432 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 98304 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    update public.items set image_path=p_image_path, thumbnail_path=p_thumbnail_path,
      image_source_url=p_image_source_url where id=v_item.id;
  end if;
  v_result := private.change_pick_impl(p_category_id,v_item.id,btrim(p_one_line_review));
  return v_result;
end;
$function$;
