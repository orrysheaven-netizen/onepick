-- Representative images belong to shared products, never to individual picks.
alter table public.products
  add column image_path text,
  add column thumbnail_path text,
  add column image_source_url text,
  add constraint products_image_pair check ((image_path is null) = (thumbnail_path is null));
create index products_category_normalized_name_idx on public.products(category_id, normalized_name);
create unique index products_image_path_unique on public.products(image_path) where image_path is not null;
create unique index products_thumbnail_path_unique on public.products(thumbnail_path) where thumbnail_path is not null;

insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
values ('10000000-0000-0000-0000-000000000001','라면','ramen','open',true,true,10)
on conflict(slug) do nothing;
insert into public.categories(name,slug,status,is_visible,is_pickable,sort_order)
values ('주류','alcohol','open',true,false,20),
('과자','snacks','open',true,true,40)
on conflict(slug) do nothing;
insert into public.categories(name,slug,parent_id,status,is_visible,is_pickable,sort_order)
select v.name,v.slug,c.id,'open',true,true,v.sort_order
from (values ('맥주','beer',21), ('소주','soju',22)) v(name,slug,sort_order)
join public.categories c on c.slug='alcohol'
on conflict(slug) do nothing;

create or replace function private.canonical_product_name(p_name text, p_slug text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare v_name text := regexp_replace(btrim(p_name),'[[:space:]]+',' ','g');
begin
  if p_slug not in ('ramen','beer','soju','snacks') then return v_name; end if;
  v_name := regexp_replace(v_name,'[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(kg|ml|g|l|개입|입|개|팩|봉|병|캔)(?=[[:space:]]|$|[×xX])',' ','gi');
  v_name := regexp_replace(v_name,'[[:space:]]*[×xX][[:space:]]*[0-9]+[[:space:]]*$','','g');
  if p_slug='ramen' then
    v_name := regexp_replace(v_name,'[[:space:]]*(봉지면|컵라면|큰사발면|작은사발면|사발면|컵면|큰사발|작은사발|봉지|큰컵|작은컵|컵|용기)(?=[[:space:]]|$)',' ','g');
  elsif p_slug in ('beer','soju') then
    v_name := regexp_replace(v_name,'[[:space:]]*(페트병|페트|캔|병)(?=[[:space:]]|$)',' ','g');
  end if;
  return regexp_replace(btrim(v_name),'[[:space:]]+',' ','g');
end; $$;
revoke all on function private.canonical_product_name(text,text) from public, anon;
grant execute on function private.canonical_product_name(text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-photos','product-photos',true,786432,array['image/jpeg']);

create or replace function private.can_upload_product_photo()
returns boolean language sql security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles where id=auth.uid())
    and (select count(*) from storage.objects where bucket_id='product-photos'
      and owner_id=auth.uid()::text and created_at > now()-interval '1 day') < 20;
$$;
revoke all on function private.can_upload_product_photo() from public, anon;
grant execute on function private.can_upload_product_photo() to authenticated;

create or replace function private.is_unused_product_photo(p_path text)
returns boolean language sql security definer set search_path = '' as $$
  select auth.uid() is not null and split_part(p_path,'/',1)=auth.uid()::text
    and not exists (select 1 from public.products where image_path=p_path or thumbnail_path=p_path);
$$;
revoke all on function private.is_unused_product_photo(text) from public, anon;
grant execute on function private.is_unused_product_photo(text) to authenticated;

create policy product_photos_own_insert on storage.objects for insert to authenticated with check (
  bucket_id='product-photos' and (storage.foldername(name))[1]=(select auth.uid()::text)
  and lower(storage.extension(name))='jpg' and (select private.can_upload_product_photo())
);
create policy product_photos_own_select on storage.objects for select to authenticated using (
  bucket_id='product-photos' and owner_id=(select auth.uid()::text)
);
create policy product_photos_unused_delete on storage.objects for delete to authenticated using (
  bucket_id='product-photos' and owner_id=(select auth.uid()::text) and private.is_unused_product_photo(name)
);

-- One bounded row per user, instead of growing an import log indefinitely.
create table private.image_import_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(), requests integer not null default 0
);
alter table private.image_import_limits enable row level security;
revoke all on private.image_import_limits from public, anon, authenticated;
create or replace function private.consume_image_import_impl()
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  insert into private.image_import_limits(user_id,requests) values (auth.uid(),1)
  on conflict(user_id) do update set
    requests=case when private.image_import_limits.window_start < now()-interval '1 hour' then 1 else private.image_import_limits.requests+1 end,
    window_start=case when private.image_import_limits.window_start < now()-interval '1 hour' then now() else private.image_import_limits.window_start end
  returning requests into v_count;
  if v_count > 10 then raise exception 'RATE_LIMITED' using errcode='P0001'; end if;
end; $$;
revoke all on function private.consume_image_import_impl() from public,anon;
grant execute on function private.consume_image_import_impl() to authenticated;
create or replace function public.consume_image_import() returns void language sql security invoker set search_path='' as $$ select private.consume_image_import_impl(); $$;
revoke all on function public.consume_image_import() from public,anon;
grant execute on function public.consume_image_import() to authenticated;

create or replace function private.register_pick_impl(
  p_category_id uuid,p_product_id uuid,p_product_name text,p_one_line_review text,
  p_image_path text,p_thumbnail_path text,p_image_source_url text
)
returns public.picks language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid(); v_category public.categories%rowtype;
  v_name text; v_normalized text; v_product public.products%rowtype; v_result public.picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  if p_one_line_review is null or char_length(btrim(p_one_line_review)) not between 1 and 100 then raise exception 'REVIEW_INVALID' using errcode='P0001'; end if;
  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
    or v_category.slug not in ('ramen','beer','soju','snacks')
    or exists(select 1 from public.categories where parent_id=p_category_id) then raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001'; end if;
  v_name := private.canonical_product_name(p_product_name,v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then raise exception 'PRODUCT_NAME_INVALID' using errcode='P0001'; end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_category_id::text,0));
  -- Serialize equivalent names while creating/resolving a shared product.
  perform pg_advisory_xact_lock(hashtextextended('product:' || p_category_id::text || ':' || v_normalized,0));
  if p_product_id is not null then
    select * into v_product from public.products where id=p_product_id for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0001'; end if;
  else
    select * into v_product from public.products where category_id=p_category_id and normalized_name=v_normalized
      order by (status in ('active','discontinued')) desc,created_at,id limit 1 for update;
    if not found then
      if (select count(*) from public.products where created_by=v_user and created_at>now()-interval '1 day')>=20 then raise exception 'RATE_LIMITED' using errcode='P0001'; end if;
      insert into public.products(category_id,name,normalized_name,status,created_by)
        values(p_category_id,v_name,v_normalized,'active',v_user) returning * into v_product;
    end if;
  end if;
  -- Existing representative images cannot be overwritten by another registration.
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
end; $$;
revoke all on function private.register_pick_impl(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function private.register_pick_impl(uuid,uuid,text,text,text,text,text) to authenticated;
create or replace function public.register_pick(
  p_category_id uuid,p_product_id uuid,p_product_name text,p_one_line_review text,
  p_image_path text default null,p_thumbnail_path text default null,p_image_source_url text default null
)
returns public.picks language sql security invoker set search_path='' as $$
  select private.register_pick_impl(p_category_id,p_product_id,p_product_name,p_one_line_review,p_image_path,p_thumbnail_path,p_image_source_url);
$$;
revoke all on function public.register_pick(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.register_pick(uuid,uuid,text,text,text,text,text) to authenticated;
