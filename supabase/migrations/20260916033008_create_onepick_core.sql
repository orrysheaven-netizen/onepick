create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  profile_image_url text,
  bio text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$')
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null,
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft','open','paused','closed')),
  is_visible boolean not null default false,
  is_pickable boolean not null default false,
  ranking_min_sample integer not null default 20 check (ranking_min_sample >= 0),
  sort_order integer not null default 0,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_not_self_parent check (parent_id is null or parent_id <> id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  slug text unique,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  brand_id uuid references public.brands(id) on delete set null,
  name text not null,
  normalized_name text not null,
  model_code text,
  official_url text,
  status text not null default 'pending' check (status in ('pending','active','discontinued','hidden','merged','rejected')),
  merged_into_product_id uuid references public.products(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_id_category_unique unique (id, category_id),
  constraint products_not_self_merged check (merged_into_product_id is null or merged_into_product_id <> id),
  constraint products_merge_state_consistent check (
    (status = 'merged' and merged_into_product_id is not null)
    or (status <> 'merged' and merged_into_product_id is null)
  )
);

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  product_id uuid not null,
  one_line_review text not null,
  status text not null default 'active' check (status in ('active','replaced','removed','needs_review','hidden')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  replaced_by_pick_id uuid references public.picks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint picks_product_category_fk foreign key (product_id, category_id)
    references public.products(id, category_id) on delete restrict,
  constraint picks_review_length check (char_length(btrim(one_line_review)) between 1 and 100),
  constraint picks_not_self_replaced check (replaced_by_pick_id is null or replaced_by_pick_id <> id),
  constraint picks_time_state_consistent check (
    (status in ('active','needs_review') and ended_at is null)
    or (status in ('replaced','removed','hidden') and ended_at is not null)
  )
);

create unique index picks_one_current_per_category
  on public.picks(user_id, category_id)
  where status in ('active','needs_review');

create index products_category_status_idx on public.products(category_id, status);
create index products_brand_idx on public.products(brand_id);
create index products_normalized_name_idx on public.products(normalized_name);
create index picks_user_status_idx on public.picks(user_id, status);
create index picks_category_started_idx on public.picks(category_id, started_at desc) where status = 'active';
create index picks_product_started_idx on public.picks(product_id, started_at desc) where status = 'active';

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function private.set_updated_at();
create trigger brands_set_updated_at before update on public.brands
for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function private.set_updated_at();
create trigger picks_set_updated_at before update on public.picks
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.picks enable row level security;

revoke all on public.profiles, public.categories, public.brands, public.products, public.picks from anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select on public.brands to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.picks to anon, authenticated;
grant insert, update on public.profiles to authenticated;

create policy profiles_public_read on public.profiles
for select to anon, authenticated using (true);

create policy profiles_self_insert on public.profiles
for insert to authenticated
with check ((select auth.uid()) = id);

create policy profiles_self_update on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy categories_public_read on public.categories
for select to anon, authenticated
using (is_visible = true and status in ('open','paused','closed'));

create policy brands_public_read on public.brands
for select to anon, authenticated
using (is_active = true);

create policy products_public_read on public.products
for select to anon, authenticated
using (status in ('active','discontinued'));

create policy picks_public_active_read on public.picks
for select to anon, authenticated
using (status = 'active');

create policy picks_self_history_read on public.picks
for select to authenticated
using ((select auth.uid()) = user_id);
