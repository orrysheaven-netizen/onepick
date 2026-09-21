begin;

-- Restaurant/place identity lives beside the generic items table. A physical
-- branch is deduplicated by provider identity, never by display name.
create table public.item_places (
  item_id uuid primary key references public.items(id) on delete cascade,
  branch_name text,
  road_address text not null,
  address text,
  region_1 text,
  region_2 text,
  latitude double precision,
  longitude double precision,
  place_provider text not null,
  provider_place_id text not null,
  map_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_places_branch_name_length check (
    branch_name is null or char_length(btrim(branch_name)) between 1 and 100
  ),
  constraint item_places_road_address_length check (
    char_length(btrim(road_address)) between 1 and 300
  ),
  constraint item_places_address_length check (
    address is null or char_length(btrim(address)) between 1 and 300
  ),
  constraint item_places_region_1_length check (
    region_1 is null or char_length(btrim(region_1)) between 1 and 100
  ),
  constraint item_places_region_2_length check (
    region_2 is null or char_length(btrim(region_2)) between 1 and 100
  ),
  constraint item_places_provider_format check (
    place_provider ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  constraint item_places_provider_place_id_length check (
    char_length(btrim(provider_place_id)) between 1 and 200
  ),
  constraint item_places_coordinate_pair check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  ),
  constraint item_places_latitude_range check (
    latitude is null or latitude between -90 and 90
  ),
  constraint item_places_longitude_range check (
    longitude is null or longitude between -180 and 180
  ),
  constraint item_places_map_url_https check (
    map_url is null or (char_length(map_url) <= 2048 and map_url ~ '^https://')
  ),
  constraint item_places_provider_identity_unique unique (place_provider, provider_place_id)
);

create table public.item_channels (
  item_id uuid not null references public.items(id) on delete cascade,
  channel text not null check (channel in ('offline','online')),
  target_url text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, channel),
  constraint item_channels_target_url_https check (
    target_url is null or (char_length(target_url) <= 2048 and target_url ~ '^https://')
  )
);

create unique index item_channels_one_primary_per_item
  on public.item_channels(item_id)
  where is_primary;
create index item_places_region_idx on public.item_places(region_1, region_2);

create trigger item_places_set_updated_at
before update on public.item_places
for each row execute function private.set_updated_at();

create trigger item_channels_set_updated_at
before update on public.item_channels
for each row execute function private.set_updated_at();

alter table public.item_places enable row level security;
alter table public.item_channels enable row level security;

revoke all on public.item_places, public.item_channels from public, anon, authenticated;
grant select on public.item_places, public.item_channels to anon, authenticated;
grant all on public.item_places, public.item_channels to service_role;

create policy item_places_anon_read on public.item_places
for select to anon using (
  exists (
    select 1 from public.items i
    where i.id = item_places.item_id
      and i.status in ('active','discontinued')
  )
);

create policy item_places_authenticated_read on public.item_places
for select to authenticated using (
  exists (
    select 1 from public.items i
    where i.id = item_places.item_id
      and (
        i.status in ('active','discontinued')
        or i.created_by = (select auth.uid())
      )
  )
);

create policy item_channels_anon_read on public.item_channels
for select to anon using (
  exists (
    select 1 from public.items i
    where i.id = item_channels.item_id
      and i.status in ('active','discontinued')
  )
);

create policy item_channels_authenticated_read on public.item_channels
for select to authenticated using (
  exists (
    select 1 from public.items i
    where i.id = item_channels.item_id
      and (
        i.status in ('active','discontinued')
        or i.created_by = (select auth.uid())
      )
  )
);

-- Internal catalog categories normally forbid same-name rows. That remains
-- correct for products, but a place item already carrying provider identity is
-- intentionally exempt: provider + place id is the duplicate boundary.
create or replace function private.prevent_internal_item_duplicate()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.item_places p where p.item_id = new.id
  ) then
    return new;
  end if;

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

revoke all on function private.prevent_internal_item_duplicate() from public, anon, authenticated;

create function private.submit_place_item_impl(
  p_category_id uuid,
  p_item_name text,
  p_place_provider text,
  p_provider_place_id text,
  p_road_address text,
  p_branch_name text default null,
  p_address text default null,
  p_region_1 text default null,
  p_region_2 text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_map_url text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_normalized text;
  v_provider text := lower(btrim(p_place_provider));
  v_provider_place_id text := btrim(p_provider_place_id);
  v_road_address text := regexp_replace(btrim(p_road_address),'[[:space:]]+',' ','g');
  v_branch_name text := nullif(regexp_replace(btrim(p_branch_name),'[[:space:]]+',' ','g'),'');
  v_address text := nullif(regexp_replace(btrim(p_address),'[[:space:]]+',' ','g'),'');
  v_region_1 text := nullif(regexp_replace(btrim(p_region_1),'[[:space:]]+',' ','g'),'');
  v_region_2 text := nullif(regexp_replace(btrim(p_region_2),'[[:space:]]+',' ','g'),'');
  v_map_url text := nullif(btrim(p_map_url),'');
  v_existing public.items%rowtype;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='P0001';
  end if;

  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;

  if not private.category_accepts_picks(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := regexp_replace(btrim(p_item_name),'[[:space:]]+',' ','g');
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  if v_provider is null
     or v_provider !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
     or v_provider_place_id is null
     or char_length(v_provider_place_id) not between 1 and 200 then
    raise exception 'PLACE_IDENTITY_INVALID' using errcode='P0001';
  end if;

  if v_road_address is null or char_length(v_road_address) not between 1 and 300
     or (v_branch_name is not null and char_length(v_branch_name)>100)
     or (v_address is not null and char_length(v_address)>300)
     or (v_region_1 is not null and char_length(v_region_1)>100)
     or (v_region_2 is not null and char_length(v_region_2)>100) then
    raise exception 'PLACE_ADDRESS_INVALID' using errcode='P0001';
  end if;

  if (p_latitude is null) <> (p_longitude is null)
     or (p_latitude is not null and p_latitude not between -90 and 90)
     or (p_longitude is not null and p_longitude not between -180 and 180) then
    raise exception 'PLACE_COORDINATES_INVALID' using errcode='P0001';
  end if;

  if v_map_url is not null
     and (char_length(v_map_url)>2048 or v_map_url !~ '^https://') then
    raise exception 'PLACE_MAP_URL_INVALID' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('place:'||v_provider||':'||v_provider_place_id,0)
  );

  select i.* into v_existing
  from public.item_places p
  join public.items i on i.id=p.item_id
  where p.place_provider=v_provider
    and p.provider_place_id=v_provider_place_id
  for update of i;

  if found then
    if v_existing.category_id<>p_category_id then
      raise exception 'PLACE_CATEGORY_MISMATCH' using errcode='P0001';
    end if;
    if v_existing.status in ('active','discontinued')
       or (v_existing.status='pending' and v_existing.created_by=v_user) then
      return v_existing;
    end if;
    if v_existing.status='pending' then
      raise exception 'PLACE_ALREADY_PENDING' using errcode='P0001';
    end if;
    raise exception 'PLACE_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  if (
    select count(*)
    from public.items
    where created_by=v_user
      and created_at>now()-interval '1 day'
  ) >= 20 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;

  -- Insert hidden first so the generic internal-catalog name guard does not
  -- reject a legitimate same-name branch before its place identity exists.
  insert into public.items(
    category_id,name,normalized_name,status,created_by
  ) values (
    p_category_id,v_name,v_normalized,'hidden',v_user
  ) returning * into v_item;

  insert into public.item_places(
    item_id,branch_name,road_address,address,region_1,region_2,
    latitude,longitude,place_provider,provider_place_id,map_url
  ) values (
    v_item.id,v_branch_name,v_road_address,v_address,v_region_1,v_region_2,
    p_latitude,p_longitude,v_provider,v_provider_place_id,v_map_url
  );

  insert into public.item_channels(item_id,channel,is_primary)
  values(v_item.id,'offline',true);

  update public.items
  set status='pending'
  where id=v_item.id
  returning * into v_item;

  return v_item;
end;
$function$;

create function public.submit_place_item(
  p_category_id uuid,
  p_item_name text,
  p_place_provider text,
  p_provider_place_id text,
  p_road_address text,
  p_branch_name text default null,
  p_address text default null,
  p_region_1 text default null,
  p_region_2 text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_map_url text default null
)
returns public.items
language sql
set search_path = ''
as $function$
  select private.submit_place_item_impl(
    p_category_id,p_item_name,p_place_provider,p_provider_place_id,p_road_address,
    p_branch_name,p_address,p_region_1,p_region_2,p_latitude,p_longitude,p_map_url
  );
$function$;

revoke all on function private.submit_place_item_impl(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text)
  from public, anon;
grant execute on function private.submit_place_item_impl(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text)
  to authenticated;

revoke all on function public.submit_place_item(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text)
  from public, anon;
grant execute on function public.submit_place_item(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text)
  to authenticated;

comment on table public.item_places is
  'One physical branch per item. Provider + provider_place_id is the place duplicate boundary; display names are not identity.';
comment on table public.item_channels is
  'Where an item can be used: offline place and/or online target. A place submission creates an offline primary channel.';
comment on function public.submit_place_item(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text) is
  'Creates or reuses a physical-place item by stable provider identity. Same-name places with different provider ids remain distinct.';

commit;
