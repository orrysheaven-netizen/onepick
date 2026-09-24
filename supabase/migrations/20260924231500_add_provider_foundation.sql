begin;

-- Block concurrent place selections until the backfill and the sync trigger
-- are both in place, so no place item can be committed without a provider.
lock table public.places, public.item_places in share row exclusive mode;

-- Provider foundation for the restaurant-first MVP.
--
--   brand -> provider (offline_branch | online_store) -> place | online_store
--   item_providers: item = provider x fine category  (the Pick target)
--
-- Purely additive. It does not alter public.items (several SQL functions such
-- as search_items return the items row type with an explicit column list, so
-- a new items column would break them), and it does not change any item id,
-- pick, comment, photo, category or category status. Items without a provider
-- (content catalogs, legacy food items) keep working exactly as before.

-- Online sales profile identity: a store operated by the party responsible for
-- the food (brand site, producer store, official platform store). Written only
-- by privileged functions (PR 0b).
create table public.online_stores (
  id uuid primary key default gen_random_uuid(),
  store_type text not null check (store_type in ('official_site','platform_store')),
  host text not null,
  platform text,
  store_key text not null unique,
  official_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_stores_host_shape check (
    char_length(host) <= 253
    and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  constraint online_stores_platform_shape check (
    platform is null or platform ~ '^[a-z][a-z0-9_]{0,31}$'
  ),
  constraint online_stores_platform_required check (
    (store_type='platform_store') = (platform is not null)
  ),
  constraint online_stores_store_key_shape check (
    char_length(store_key) between 3 and 300
    and store_key !~ '[[:space:]]'
    and (
      (store_type='official_site' and store_key='site:'||host)
      or (store_type='platform_store' and store_key like platform||':_%')
    )
  ),
  constraint online_stores_official_url_shape check (
    official_url ~ '^https://[^[:space:]]+$' and char_length(official_url) <= 2048
  )
);

-- The profile a user sees and picks from: an offline branch or an online store.
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('offline_branch','online_store')),
  name text not null,
  branch_name text,
  brand_id uuid references public.brands(id) on delete restrict,
  place_id uuid unique references public.places(id) on delete restrict,
  online_store_id uuid unique references public.online_stores(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','hidden')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint providers_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint providers_branch_name_length check (
    branch_name is null or char_length(btrim(branch_name)) between 1 and 100
  ),
  constraint providers_kind_target check (
    (kind='offline_branch' and place_id is not null and online_store_id is null)
    or (kind='online_store' and online_store_id is not null and place_id is null)
  )
);

create index providers_brand_idx on public.providers(brand_id) where brand_id is not null;

-- items = provider x category. One provider per item, one item per provider and
-- category. The composite FK keeps the mapped category equal to the item's.
create table public.item_providers (
  item_id uuid primary key,
  category_id uuid not null,
  provider_id uuid not null references public.providers(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint item_providers_item_category_fk foreign key (item_id, category_id)
    references public.items(id, category_id) on delete cascade,
  unique(provider_id, category_id)
);

create trigger online_stores_set_updated_at before update on public.online_stores
for each row execute function private.set_updated_at();

create trigger providers_set_updated_at before update on public.providers
for each row execute function private.set_updated_at();

-- Idempotent: one offline provider per place, then map each place-backed item.
-- Place providers start active; public visibility and pick eligibility keep
-- following places.is_visible (RLS and item_accepts_pick check it), so hiding
-- or re-showing a place behaves exactly as before. Provider status is only for
-- explicit moderation.
create or replace function private.backfill_place_providers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked integer;
begin
  insert into public.providers(kind,name,branch_name,place_id,status)
  select 'offline_branch', btrim(p.name), nullif(btrim(p.branch_name),''), p.id, 'active'
  from public.places p
  on conflict (place_id) do nothing;

  insert into public.item_providers(item_id,category_id,provider_id)
  select ip.item_id, ip.category_id, pr.id
  from public.item_places ip
  join public.providers pr on pr.place_id=ip.place_id
  on conflict (item_id) do nothing;

  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

revoke all on function private.backfill_place_providers() from public, anon, authenticated;

-- Place-backed items never set brand_id today; fail loudly instead of guessing.
do $$
begin
  if exists (
    select 1
    from public.items i
    join public.item_places ip on ip.item_id=i.id
    where i.brand_id is not null
  ) then
    raise exception 'PROVIDER_BACKFILL_BRAND_CONFLICT: a place-backed item already has brand_id';
  end if;
end;
$$;

select private.backfill_place_providers();

do $$
begin
  if exists (select 1 from public.places p where not exists (
    select 1 from public.providers pr where pr.place_id=p.id
  )) then
    raise exception 'PROVIDER_BACKFILL_INCOMPLETE: a place has no provider';
  end if;

  if exists (
    select 1
    from public.item_places ip
    left join public.item_providers ipr on ipr.item_id=ip.item_id
    left join public.providers pr on pr.id=ipr.provider_id
    where pr.id is null or pr.place_id is distinct from ip.place_id
  ) then
    raise exception 'PROVIDER_BACKFILL_INCOMPLETE: a place-backed item is not mapped to its place provider';
  end if;
end;
$$;

-- New place-backed items (select_place_catalog_item, admin_upsert_place_item)
-- insert item_places after the item; attach or create the place provider here
-- so those functions keep working unchanged.
create or replace function private.sync_place_item_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place public.places%rowtype;
  v_provider uuid;
  v_current uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('provider-place:'||new.place_id::text,0)
  );

  select id into v_provider
  from public.providers
  where place_id=new.place_id;

  if v_provider is null then
    select * into v_place from public.places where id=new.place_id;

    insert into public.providers(kind,name,branch_name,place_id,status)
    values(
      'offline_branch', btrim(v_place.name), nullif(btrim(v_place.branch_name),''), v_place.id, 'active'
    )
    returning id into v_provider;
  end if;

  select provider_id into v_current
  from public.item_providers
  where item_id=new.item_id;

  if v_current is null then
    insert into public.item_providers(item_id,category_id,provider_id)
    values(new.item_id,new.category_id,v_provider);
  elsif v_current<>v_provider then
    raise exception 'ITEM_PROVIDER_MISMATCH' using errcode='P0001';
  end if;

  return null;
end;
$$;

revoke all on function private.sync_place_item_provider() from public, anon, authenticated;

create trigger item_places_sync_provider
after insert on public.item_places
for each row execute function private.sync_place_item_provider();

-- Cross-table invariants, checked at commit so multi-statement writers
-- (item first, item_places second) are not rejected mid-transaction:
--   * a place-backed item has a provider
--   * an offline provider item maps to exactly its provider's place
--   * an online provider item has no place mapping
--   * a new provider mapping is only created for an item without its own brand
--     (the brand comes through the provider). Existing items.brand_id writes are
--     not constrained here, so current admin item edits behave as before.
create or replace function private.assert_item_provider_consistency(p_item_id uuid, p_check_brand boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_provider_id uuid;
  v_kind text;
  v_place_id uuid;
begin
  select i.brand_id into v_brand_id
  from public.items i
  where i.id=p_item_id;

  if not found then
    return;
  end if;

  select pr.id, pr.kind, pr.place_id
  into v_provider_id, v_kind, v_place_id
  from public.item_providers ipr
  join public.providers pr on pr.id=ipr.provider_id
  where ipr.item_id=p_item_id;

  if v_provider_id is null then
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ITEM_PROVIDER_REQUIRED' using errcode='23514';
    end if;
    return;
  end if;

  if p_check_brand and v_brand_id is not null then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;

  if v_kind='offline_branch' then
    if not exists (
      select 1 from public.item_places
      where item_id=p_item_id and place_id=v_place_id
    ) then
      raise exception 'ITEM_PROVIDER_PLACE_MISMATCH' using errcode='23514';
    end if;
  elsif exists (select 1 from public.item_places where item_id=p_item_id) then
    raise exception 'ONLINE_PROVIDER_ITEM_HAS_PLACE' using errcode='23514';
  end if;
end;
$$;

revoke all on function private.assert_item_provider_consistency(uuid, boolean) from public, anon, authenticated;

create or replace function private.check_item_provider_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    perform private.assert_item_provider_consistency(old.item_id);
  else
    perform private.assert_item_provider_consistency(new.item_id, tg_table_name='item_providers');
    if tg_op='UPDATE' and old.item_id<>new.item_id then
      perform private.assert_item_provider_consistency(old.item_id);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.check_item_provider_consistency() from public, anon, authenticated;

create constraint trigger item_providers_consistency
after insert or update or delete on public.item_providers
deferrable initially deferred
for each row execute function private.check_item_provider_consistency();

create constraint trigger item_places_provider_consistency
after insert or update or delete on public.item_places
deferrable initially deferred
for each row execute function private.check_item_provider_consistency();

-- Moving a provider between places, or between offline and online, would
-- silently re-home every mapped item. Provider identity is fixed once created.
create or replace function private.guard_provider_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.place_id is distinct from old.place_id
     or new.online_store_id is distinct from old.online_store_id then
    raise exception 'PROVIDER_IDENTITY_IMMUTABLE' using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_provider_identity() from public, anon, authenticated;

create trigger providers_guard_identity
before update of kind, place_id, online_store_id on public.providers
for each row execute function private.guard_provider_identity();

-- Pick gate: a provider-backed item is pickable only while its provider is
-- active and, for offline providers, its place is visible. Items without a
-- provider keep the previous rule unchanged.
create or replace function private.item_accepts_pick(p_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when exists (select 1 from public.item_providers ipr where ipr.item_id=p_item_id) then exists (
        select 1
        from public.item_providers ipr
        join public.providers pr on pr.id=ipr.provider_id
        left join public.places p on p.id=pr.place_id
        where ipr.item_id=p_item_id
          and pr.status='active'
          and (pr.kind='online_store' or p.is_visible)
      )
      else (
        not exists (
          select 1
          from public.item_channels ch
          where ch.item_id=p_item_id
            and ch.channel='offline'
        )
        or exists (
          select 1
          from public.item_places ip
          join public.places p on p.id=ip.place_id
          where ip.item_id=p_item_id
            and p.is_visible
        )
      )
    end;
$$;

revoke all on function private.item_accepts_pick(uuid)
  from public, anon, authenticated;

-- Provider-backed items are identified by provider x category, never by name:
-- two different stores may share a display name. Provider items must carry
-- external_source 'onepick_place' (offline) or 'onepick_provider' (online, PR 0b).
create or replace function private.prevent_internal_item_duplicate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.external_source in ('onepick_place','onepick_provider') then
    return new;
  end if;

  if new.status in ('pending','active','discontinued')
     and exists (
       select 1
       from public.category_catalog_sources s
       where s.category_id=new.category_id
         and s.mode='internal'
         and s.is_enabled=true
     ) then
    perform pg_advisory_xact_lock(
      hashtextextended(
        'internal-item:'||new.category_id::text||':'||new.normalized_name,
        0
      )
    );

    if exists (
      select 1
      from public.items i
      where i.category_id=new.category_id
        and i.normalized_name=new.normalized_name
        and i.status in ('pending','active','discontinued')
        and i.external_source is distinct from 'onepick_place'
        and i.external_source is distinct from 'onepick_provider'
        and i.id<>new.id
    ) then
      raise exception 'ITEM_DUPLICATE' using errcode='23505';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_internal_item_duplicate()
  from public, anon, authenticated;

-- Read access mirrors places/item_places: public profiles are active and, when
-- offline, located at a visible place. Writes go through privileged functions.
alter table public.online_stores enable row level security;
alter table public.providers enable row level security;
alter table public.item_providers enable row level security;

revoke all on public.online_stores, public.providers, public.item_providers
  from public, anon, authenticated;
grant select on public.online_stores, public.providers, public.item_providers
  to anon, authenticated;
grant all on public.online_stores, public.providers, public.item_providers
  to service_role;

create policy providers_anon_read on public.providers
for select to anon
using (
  status='active'
  and (
    kind='online_store'
    or exists (
      select 1 from public.places p
      where p.id=providers.place_id
        and p.is_visible
    )
  )
);

create policy providers_authenticated_read on public.providers
for select to authenticated
using (
  (select private.is_admin_mfa())
  or (
    status='active'
    and (
      kind='online_store'
      or exists (
        select 1 from public.places p
        where p.id=providers.place_id
          and p.is_visible
      )
    )
  )
);

create policy online_stores_anon_read on public.online_stores
for select to anon
using (
  exists (
    select 1 from public.providers pr
    where pr.online_store_id=online_stores.id
      and pr.status='active'
  )
);

create policy online_stores_authenticated_read on public.online_stores
for select to authenticated
using (
  (select private.is_admin_mfa())
  or exists (
    select 1 from public.providers pr
    where pr.online_store_id=online_stores.id
      and pr.status='active'
  )
);

-- A mapping is public when both the item and the provider are publicly readable
-- (the providers policy applies inside the subquery).
create policy item_providers_anon_read on public.item_providers
for select to anon
using (
  exists (
    select 1 from public.items i
    where i.id=item_providers.item_id
      and i.status in ('active','discontinued')
  )
  and exists (
    select 1 from public.providers pr
    where pr.id=item_providers.provider_id
  )
);

create policy item_providers_authenticated_read on public.item_providers
for select to authenticated
using (
  (select private.is_admin_mfa())
  or (
    exists (
      select 1 from public.items i
      where i.id=item_providers.item_id
        and i.status in ('active','discontinued')
    )
    and exists (
      select 1 from public.providers pr
      where pr.id=item_providers.provider_id
    )
  )
);

commit;
