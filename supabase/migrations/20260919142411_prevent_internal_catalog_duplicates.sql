create or replace function private.prevent_internal_item_duplicate()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status in ('pending','active','discontinued')
     and exists (
       select 1
       from public.category_catalog_sources s
       where s.category_id = new.category_id
         and s.mode = 'internal'
         and s.is_enabled = true
     ) then

    perform pg_advisory_xact_lock(
      hashtextextended(
        'internal-item:' || new.category_id::text || ':' || new.normalized_name,
        0
      )
    );

    if exists (
      select 1
      from public.items i
      where i.category_id = new.category_id
        and i.normalized_name = new.normalized_name
        and i.status in ('pending','active','discontinued')
        and i.id <> new.id
    ) then
      raise exception 'ITEM_DUPLICATE'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.prevent_internal_item_duplicate() from public;
revoke all on function private.prevent_internal_item_duplicate() from anon;
revoke all on function private.prevent_internal_item_duplicate() from authenticated;

drop trigger if exists items_prevent_internal_duplicate on public.items;

create trigger items_prevent_internal_duplicate
before insert or update of category_id, normalized_name, status
on public.items
for each row
execute function private.prevent_internal_item_duplicate();

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
      and (metadata->>'size')::bigint between 1 and 786432
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
      and (metadata->>'size')::bigint between 1 and 98304
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

