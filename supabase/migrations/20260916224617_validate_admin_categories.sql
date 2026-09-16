-- Category settings are administrator-owned. Keep the two-level tree valid
-- even when multiple administrators write through the Data API.
alter table private.admin_users enable row level security;
drop policy products_user_submit_pending on public.products;
-- User requests must pass submit_product's quota, normalization and photo checks.

create function private.validate_category_tree()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_parent public.categories%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('category-tree', 0));
  if char_length(btrim(new.name)) not between 1 and 60
    or char_length(new.slug) > 80 or new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or abs(new.sort_order::bigint) > 100000 or new.ranking_min_sample < 1
  then raise exception 'CATEGORY_INVALID' using errcode='P0001'; end if;
  if tg_op='UPDATE' and new.slug is distinct from old.slug then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;
  if new.parent_id is not null then
    select * into v_parent from public.categories where id=new.parent_id;
    if not found or new.parent_id=new.id or v_parent.parent_id is not null or v_parent.is_pickable
      or exists(select 1 from public.categories where parent_id=new.id)
    then raise exception 'CATEGORY_INVALID' using errcode='P0001'; end if;
  end if;
  if new.is_pickable and exists(select 1 from public.categories where parent_id=new.id) then
    raise exception 'CATEGORY_INVALID' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_category_tree() from public, anon, authenticated;
create trigger validate_category_tree before insert or update on public.categories
for each row execute function private.validate_category_tree();

create function private.category_accepts_picks(p_category_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from public.categories c
    left join public.categories p on p.id=c.parent_id
    where c.id=p_category_id and c.status='open' and c.is_visible and c.is_pickable
      and not exists(select 1 from public.categories child where child.parent_id=c.id)
      and (c.parent_id is null or (p.parent_id is null and p.status='open' and p.is_visible and not p.is_pickable))
  );
$$;
revoke all on function private.category_accepts_picks(uuid) from public, anon, authenticated;

create function private.check_pick_category()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='active' and not private.category_accepts_picks(new.category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_pick_category() from public, anon, authenticated;
create trigger check_pick_category before insert or update of category_id,product_id,status on public.picks
for each row execute function private.check_pick_category();

-- Retry only the caller's pending request; never return another user's private submission.
create or replace function private.submit_product_impl(
  p_category_id uuid,
  p_product_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
  v_product public.products%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found or not private.category_accepts_picks(p_category_id)
  then raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001'; end if;

  v_name := private.canonical_product_name(p_product_name, v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'PRODUCT_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  perform pg_advisory_xact_lock(hashtextextended('product:' || p_category_id::text || ':' || v_normalized,0));

  select * into v_product
  from public.products
  where category_id=p_category_id
    and normalized_name=v_normalized
    and (status in ('active','discontinued') or (status='pending' and created_by=v_user))
  order by case status when 'active' then 0 when 'discontinued' then 1 else 2 end, created_at, id
  limit 1
  for update;

  if found then return v_product; end if;

  if (select count(*) from public.products where created_by=v_user and created_at>now()-interval '1 day') >= 20 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;

  if p_image_path is not null or p_thumbnail_path is not null then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
      or split_part(p_image_path,'/',1)<>v_user::text or split_part(p_thumbnail_path,'/',1)<>v_user::text
    then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    perform 1 from storage.objects where bucket_id='product-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 786432 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    perform 1 from storage.objects where bucket_id='product-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 98304 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
  end if;

  insert into public.products(
    category_id,name,normalized_name,status,created_by,image_path,thumbnail_path,image_source_url
  ) values (
    p_category_id,v_name,v_normalized,'pending',v_user,p_image_path,p_thumbnail_path,p_image_source_url
  ) returning * into v_product;

  return v_product;
end;
$$;

