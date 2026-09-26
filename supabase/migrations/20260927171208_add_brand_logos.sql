-- Brand logos (99밀크티 → its logo), shown next to a menu photo and used as the
-- card image when a menu has no photo yet.
--
-- - Logos live in their own public bucket, `brand-logos`, under `<brand id>/`.
--   Only AAL2 admins can write it; logos are trademarks, so users never upload them.
-- - `brands.logo_path` points at that object. A trigger checks the object exists
--   before the path is stored, so every write path (REST PATCH or SQL) is covered.
-- - The legacy free-text `logo_url` column is left untouched and unused.
-- - `public.item_brands(item_ids)` returns each item's brand for card reads:
--   provider-backed items (food) get it through providers.brand_id, other items
--   through items.brand_id. It runs as the caller, so the existing read policies
--   (inactive brand, hidden provider or place) decide what is visible.

begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('brand-logos','brand-logos',true,1048576,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public=excluded.public,
      file_size_limit=excluded.file_size_limit,
      allowed_mime_types=excluded.allowed_mime_types;

alter table public.brands
  add column logo_path text,
  add constraint brands_logo_path_shape check (
    logo_path is null
    or (
      logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$'
      and split_part(logo_path,'/',1)=id::text
    )
  );

create unique index brands_logo_path_unique on public.brands(logo_path) where logo_path is not null;

create or replace function private.guard_brand_logo_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logo_path is not null
    and (tg_op='INSERT' or new.logo_path is distinct from old.logo_path)
    and not exists (
      select 1 from storage.objects
      where bucket_id='brand-logos' and name=new.logo_path
    )
  then
    raise exception 'BRAND_LOGO_NOT_FOUND' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_brand_logo_path() from public, anon, authenticated;

create trigger brands_guard_logo_path
before insert or update of logo_path on public.brands
for each row execute function private.guard_brand_logo_path();

create or replace function private.is_unused_brand_logo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.brands where logo_path=p_path);
$$;
revoke all on function private.is_unused_brand_logo(text) from public, anon;
grant execute on function private.is_unused_brand_logo(text) to authenticated;

create policy brand_logos_admin_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='brand-logos'
  and (select private.is_admin_mfa())
  -- Qualified: an unqualified `name` inside the subquery would bind to brands.name.
  and exists (
    select 1 from public.brands b
    where b.id::text=(storage.foldername(objects.name))[1]
  )
  and lower(storage.extension(objects.name)) in ('png','jpg','webp')
);

create policy brand_logos_admin_select on storage.objects
for select to authenticated
using (bucket_id='brand-logos' and (select private.is_admin_mfa()));

-- A logo a brand still points at cannot be deleted; replace the path first.
create policy brand_logos_admin_delete on storage.objects
for delete to authenticated
using (
  bucket_id='brand-logos'
  and (select private.is_admin_mfa())
  and private.is_unused_brand_logo(name)
);

create or replace function public.item_brands(p_item_ids uuid[])
returns table (item_id uuid, brand_id uuid, brand_name text, logo_path text)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, b.id, b.name, b.logo_path
  from public.items i
  left join public.item_providers ip on ip.item_id=i.id
  left join public.providers pr on pr.id=ip.provider_id
  join public.brands b on b.id=coalesce(pr.brand_id, i.brand_id)
  where i.id = any(p_item_ids[1:100]);
$$;
revoke all on function public.item_brands(uuid[]) from public;
grant execute on function public.item_brands(uuid[]) to anon, authenticated;

commit;
