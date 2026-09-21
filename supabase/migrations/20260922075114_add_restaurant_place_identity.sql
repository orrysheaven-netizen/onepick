begin;

create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_name text,
  road_address text not null,
  address text,
  region_1 text,
  region_2 text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  place_provider text not null,
  provider_place_id text not null,
  map_url text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint places_branch_name_length check (branch_name is null or char_length(btrim(branch_name)) between 1 and 100),
  constraint places_road_address_length check (char_length(btrim(road_address)) between 1 and 300),
  constraint places_address_length check (address is null or char_length(btrim(address)) between 1 and 300),
  constraint places_region_1_length check (region_1 is null or char_length(btrim(region_1)) between 1 and 80),
  constraint places_region_2_length check (region_2 is null or char_length(btrim(region_2)) between 1 and 80),
  constraint places_coordinate_pair check ((latitude is null) = (longitude is null)),
  constraint places_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint places_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint places_provider_shape check (place_provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint places_provider_id_length check (char_length(btrim(provider_place_id)) between 1 and 200),
  constraint places_map_url_shape check (map_url is null or (map_url ~ '^https://[^[:space:]]+$' and char_length(map_url) <= 2048)),
  unique(place_provider, provider_place_id)
);

create table public.item_places (
  item_id uuid primary key,
  category_id uuid not null,
  place_id uuid not null references public.places(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint item_places_item_category_fk foreign key (item_id, category_id)
    references public.items(id, category_id) on delete cascade,
  unique(place_id, category_id)
);

create table public.item_channels (
  item_id uuid not null references public.items(id) on delete cascade,
  channel text not null check (channel in ('offline','online')),
  target_url text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(item_id, channel),
  constraint item_channels_target_url_shape check (
    target_url is null or (target_url ~ '^https://[^[:space:]]+$' and char_length(target_url) <= 2048)
  )
);

create unique index item_channels_one_primary_per_item
  on public.item_channels(item_id) where is_primary;
create index item_places_place_idx on public.item_places(place_id);
create index places_region_idx on public.places(region_1, region_2) where is_visible;

create trigger places_set_updated_at before update on public.places
for each row execute function private.set_updated_at();

create trigger item_channels_set_updated_at before update on public.item_channels
for each row execute function private.set_updated_at();

alter table public.places enable row level security;
alter table public.item_places enable row level security;
alter table public.item_channels enable row level security;

revoke all on public.places, public.item_places, public.item_channels from public, anon, authenticated;
grant select on public.places, public.item_places, public.item_channels to anon, authenticated;
grant all on public.places, public.item_places, public.item_channels to service_role;

create policy places_anon_read on public.places
for select to anon
using (is_visible);

create policy places_authenticated_read on public.places
for select to authenticated
using ((select private.is_admin_mfa()) or is_visible);

create policy item_places_anon_read on public.item_places
for select to anon
using (
  exists (
    select 1
    from public.items i
    join public.places p on p.id=item_places.place_id
    where i.id=item_places.item_id
      and i.category_id=item_places.category_id
      and i.status in ('active','discontinued')
      and p.is_visible
  )
);

create policy item_places_authenticated_read on public.item_places
for select to authenticated
using (
  (select private.is_admin_mfa())
  or exists (
    select 1
    from public.items i
    join public.places p on p.id=item_places.place_id
    where i.id=item_places.item_id
      and i.category_id=item_places.category_id
      and i.status in ('active','discontinued')
      and p.is_visible
  )
);

create policy item_channels_anon_read on public.item_channels
for select to anon
using (
  exists (
    select 1 from public.items i
    where i.id=item_channels.item_id
      and i.status in ('active','discontinued')
  )
);

create policy item_channels_authenticated_read on public.item_channels
for select to authenticated
using (
  (select private.is_admin_mfa())
  or exists (
    select 1 from public.items i
    where i.id=item_channels.item_id
      and i.status in ('active','discontinued')
  )
);

create or replace function private.prevent_internal_item_duplicate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.external_source='onepick_place' then
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

create or replace function private.item_accepts_pick(p_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
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
    );
$$;

revoke all on function private.item_accepts_pick(uuid)
  from public, anon, authenticated;

create or replace function private.check_pick_place_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status='active'
     and not private.item_accepts_pick(new.item_id) then
    raise exception 'PLACE_IDENTITY_REQUIRED' using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.check_pick_place_identity()
  from public, anon, authenticated;

create trigger check_pick_place_identity
before insert or update of item_id, status on public.picks
for each row execute function private.check_pick_place_identity();

create or replace function private.admin_upsert_place_item_impl(
  p_category_id uuid,
  p_place_name text,
  p_branch_name text,
  p_place_provider text,
  p_provider_place_id text,
  p_road_address text,
  p_address text default null,
  p_region_1 text default null,
  p_region_2 text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_map_url text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.categories%rowtype;
  v_place public.places%rowtype;
  v_item public.items%rowtype;
  v_name text := btrim(regexp_replace(coalesce(p_place_name,''),'[[:space:]]+',' ','g'));
  v_branch text := nullif(btrim(regexp_replace(coalesce(p_branch_name,''),'[[:space:]]+',' ','g')),'');
  v_provider text := lower(btrim(coalesce(p_place_provider,'')));
  v_provider_id text := btrim(coalesce(p_provider_place_id,''));
  v_road text := btrim(regexp_replace(coalesce(p_road_address,''),'[[:space:]]+',' ','g'));
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_category
  from public.categories
  where id=p_category_id;

  if not found or not public.category_is_open_leaf(v_category.id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  if char_length(v_name) not between 1 and 100
     or v_provider !~ '^[a-z][a-z0-9_]{0,31}$'
     or char_length(v_provider_id) not between 1 and 200
     or char_length(v_road) not between 1 and 300
     or (v_branch is not null and char_length(v_branch)>100)
     or ((p_latitude is null) <> (p_longitude is null))
     or (p_latitude is not null and p_latitude not between -90 and 90)
     or (p_longitude is not null and p_longitude not between -180 and 180)
     or (
       p_map_url is not null
       and (
         p_map_url !~ '^https://[^[:space:]]+$'
         or char_length(p_map_url)>2048
       )
     ) then
    raise exception 'PLACE_INVALID' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('place:'||v_provider||':'||v_provider_id,0)
  );

  select * into v_place
  from public.places
  where place_provider=v_provider
    and provider_place_id=v_provider_id
  for update;

  if found then
    update public.places
    set name=v_name,
        branch_name=v_branch,
        road_address=v_road,
        address=nullif(btrim(p_address),''),
        region_1=nullif(btrim(p_region_1),''),
        region_2=nullif(btrim(p_region_2),''),
        latitude=p_latitude,
        longitude=p_longitude,
        map_url=p_map_url,
        is_visible=true
    where id=v_place.id
    returning * into v_place;
  else
    insert into public.places(
      name,branch_name,road_address,address,region_1,region_2,
      latitude,longitude,place_provider,provider_place_id,map_url
    )
    values(
      v_name,v_branch,v_road,nullif(btrim(p_address),''),
      nullif(btrim(p_region_1),''),nullif(btrim(p_region_2),''),
      p_latitude,p_longitude,v_provider,v_provider_id,p_map_url
    )
    returning * into v_place;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'place-item:'||v_place.id::text||':'||p_category_id::text,
      0
    )
  );

  select i.* into v_item
  from public.item_places ip
  join public.items i
    on i.id=ip.item_id
   and i.category_id=ip.category_id
  where ip.place_id=v_place.id
    and ip.category_id=p_category_id
  for update of i;

  if found then
    insert into public.item_channels(item_id,channel,target_url,is_primary)
    values(v_item.id,'offline',p_map_url,true)
    on conflict(item_id,channel) do update
    set target_url=excluded.target_url,
        is_primary=true,
        updated_at=now();
    return v_item;
  end if;

  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  insert into public.items(
    category_id,name,normalized_name,status,external_source,external_id
  )
  values(
    p_category_id,v_name,v_normalized,'active','onepick_place',
    v_place.id::text||':'||p_category_id::text
  )
  returning * into v_item;

  insert into public.item_places(item_id,category_id,place_id)
  values(v_item.id,p_category_id,v_place.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'offline',p_map_url,true);

  return v_item;
end;
$$;

revoke all on function private.admin_upsert_place_item_impl(
  uuid,text,text,text,text,text,text,text,text,numeric,numeric,text
) from public, anon;

grant execute on function private.admin_upsert_place_item_impl(
  uuid,text,text,text,text,text,text,text,text,numeric,numeric,text
) to authenticated;

create or replace function public.admin_upsert_place_item(
  p_category_id uuid,
  p_place_name text,
  p_branch_name text,
  p_place_provider text,
  p_provider_place_id text,
  p_road_address text,
  p_address text default null,
  p_region_1 text default null,
  p_region_2 text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_map_url text default null
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.admin_upsert_place_item_impl(
    p_category_id,p_place_name,p_branch_name,p_place_provider,
    p_provider_place_id,p_road_address,p_address,p_region_1,p_region_2,
    p_latitude,p_longitude,p_map_url
  );
$$;

revoke all on function public.admin_upsert_place_item(
  uuid,text,text,text,text,text,text,text,text,numeric,numeric,text
) from public, anon;

grant execute on function public.admin_upsert_place_item(
  uuid,text,text,text,text,text,text,text,text,numeric,numeric,text
) to authenticated;

commit;
