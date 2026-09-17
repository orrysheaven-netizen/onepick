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
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
    or exists(select 1 from public.categories where parent_id=p_category_id)
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
    and status in ('active','discontinued','pending')
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

revoke all on function private.submit_product_impl(uuid,text,text,text,text) from public, anon;
grant execute on function private.submit_product_impl(uuid,text,text,text,text) to authenticated;

create or replace function public.submit_product(
  p_category_id uuid,
  p_product_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.products
language sql
security invoker
set search_path=''
as $$
  select private.submit_product_impl(p_category_id,p_product_name,p_image_path,p_thumbnail_path,p_image_source_url);
$$;

revoke all on function public.submit_product(uuid,text,text,text,text) from public, anon;
grant execute on function public.submit_product(uuid,text,text,text,text) to authenticated;

create or replace function private.register_pick_impl(
  p_category_id uuid,p_product_id uuid,p_product_name text,p_one_line_review text,
  p_image_path text,p_thumbnail_path text,p_image_source_url text
)
returns public.picks
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_product public.products%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  if p_one_line_review is null or char_length(btrim(p_one_line_review)) not between 1 and 100 then raise exception 'REVIEW_INVALID' using errcode='P0001'; end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
    or exists(select 1 from public.categories where parent_id=p_category_id)
  then raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001'; end if;

  if p_product_id is null then raise exception 'PRODUCT_SELECTION_REQUIRED' using errcode='P0001'; end if;

  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0001'; end if;
  if v_product.category_id<>p_category_id then raise exception 'PRODUCT_CATEGORY_MISMATCH' using errcode='P0001'; end if;
  if v_product.status not in ('active','discontinued') then raise exception 'PRODUCT_NOT_ELIGIBLE' using errcode='P0001'; end if;

  if v_product.image_path is null and (p_image_path is not null or p_thumbnail_path is not null) then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
      or split_part(p_image_path,'/',1)<>v_user::text or split_part(p_thumbnail_path,'/',1)<>v_user::text
    then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='product-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 786432 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='product-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 98304 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    update public.products set image_path=p_image_path,thumbnail_path=p_thumbnail_path,image_source_url=p_image_source_url
      where id=v_product.id;
  end if;

  v_result := private.change_pick_impl(p_category_id,v_product.id,btrim(p_one_line_review));
  return v_result;
end;
$$;
