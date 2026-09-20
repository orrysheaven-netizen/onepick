begin;

-- General product requests should not force users to understand or create the
-- category tree. Keep them in a private staging category until an admin
-- classifies the product during review.
insert into public.categories(
  id,parent_id,name,slug,status,is_visible,is_pickable,sort_order
)
values (
  gen_random_uuid(),null,'상품 분류 대기','pending-product','open',false,false,100000
)
on conflict (slug) do update
set
  name=excluded.name,
  status='open',
  is_visible=false,
  is_pickable=false,
  sort_order=excluded.sort_order,
  updated_at=now();

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
      and (metadata->>'size')::bigint between 1 and 786432
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and (metadata->>'size')::bigint between 1 and 98304
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

create or replace function public.submit_unclassified_item(
  p_item_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.items
language sql
set search_path = ''
as $$
  select private.submit_unclassified_item_impl(
    p_item_name,p_image_path,p_thumbnail_path,p_image_source_url
  );
$$;

revoke all on function private.submit_unclassified_item_impl(text,text,text,text)
  from public, anon;
grant execute on function private.submit_unclassified_item_impl(text,text,text,text)
  to authenticated, service_role;
revoke all on function public.submit_unclassified_item(text,text,text,text)
  from public, anon;
grant execute on function public.submit_unclassified_item(text,text,text,text)
  to authenticated, service_role;

-- Pending products staged without a category cannot become active until an
-- admin assigns a real selectable category.
create or replace function public.admin_review_pending_item(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null
)
returns public.items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found or v_item.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  if p_status='rejected' then
    update public.items
    set status='rejected', merged_into_item_id=null
    where id=v_item.id
    returning * into v_item;
    return v_item;
  end if;

  if p_status<>'active' then
    raise exception 'ITEM_STATUS_INVALID' using errcode='P0001';
  end if;

  select * into v_category
  from public.categories
  where id=coalesce(p_category_id,v_item.category_id);

  if not found
     or v_category.slug='pending-product'
     or not public.category_is_open_leaf(v_category.id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := private.canonical_item_name(v_item.name,v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  if exists (
    select 1 from public.items i
    where i.id<>v_item.id
      and i.category_id=v_category.id
      and i.normalized_name=v_normalized
      and i.status in ('active','discontinued')
  ) then
    raise exception 'ITEM_DUPLICATE' using errcode='P0001';
  end if;

  update public.items
  set category_id=v_category.id,
      name=v_name,
      normalized_name=v_normalized,
      status='active',
      merged_into_item_id=null
  where id=v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

revoke all on function public.admin_review_pending_item(uuid,text,uuid)
  from public, anon;
grant execute on function public.admin_review_pending_item(uuid,text,uuid)
  to authenticated, service_role;

-- Preserve the existing merge rules, but allow a staged general-product
-- request to merge into the admin-selected real category.
create or replace function public.admin_merge_pending_item(
  p_source_item_id uuid,
  p_target_item_id uuid
)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v_source public.items%rowtype;
  v_target public.items%rowtype;
  v_source_category_slug text;
  v_result public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_source_item_id is null
     or p_target_item_id is null
     or p_source_item_id=p_target_item_id then
    raise exception 'MERGE_TARGET_INVALID' using errcode='P0001';
  end if;

  select * into v_source
  from public.items
  where id=p_source_item_id
  for update;

  if not found or v_source.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  select * into v_target
  from public.items
  where id=p_target_item_id
  for update;

  if not found or v_target.status not in ('active','discontinued') then
    raise exception 'TARGET_ITEM_INVALID' using errcode='P0001';
  end if;

  if v_source.category_id<>v_target.category_id then
    select slug into v_source_category_slug
    from public.categories where id=v_source.category_id;

    if v_source_category_slug is distinct from 'pending-product' then
      raise exception 'MERGE_CATEGORY_MISMATCH' using errcode='P0001';
    end if;
  end if;

  if exists(select 1 from public.picks where item_id=v_source.id) then
    raise exception 'SOURCE_ITEM_IN_USE' using errcode='P0001';
  end if;

  update public.items
  set status='merged',
      merged_into_item_id=v_target.id
  where id=v_source.id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_merge_pending_item(uuid,uuid)
  from public, anon;
grant execute on function public.admin_merge_pending_item(uuid,uuid)
  to authenticated, service_role;

commit;
