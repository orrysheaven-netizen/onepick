-- Admin "채널 연결": give existing, channel-less food items a 매장 (place) or
-- 온라인 (online store) identity so they appear under Home's 매장/온라인 tabs.
--
-- Items registered through the old request → approval path have no
-- item_channels, item_places or item_providers. Linking keeps the item row (and
-- therefore every Pick, comment and history row) and adds the same identity a
-- newly selected place / provider item would have:
--   매장:  external_source=onepick_place, item_places → offline provider, 'offline' channel
--   온라인: external_source=onepick_provider, item_providers, 'online' channel
-- The deferred items_provider_consistency trigger checks the result at commit.
--
-- To avoid two copies of subtle identity logic, the place-from-catalog and
-- online-store/provider resolution move into private helpers; the existing user
-- place selection and admin provider upsert call them with unchanged behavior.

begin;

-- ---------------------------------------------------------------------------
-- Shared helper: trusted place_catalog row → canonical, visible places row
-- (body moved verbatim from select_place_catalog_item_impl).
-- ---------------------------------------------------------------------------
create or replace function private.place_from_catalog(p_catalog_id uuid)
returns public.places
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_catalog public.place_catalog%rowtype;
  v_place public.places%rowtype;
  v_match_id uuid;
  v_road text;
  v_address text;
  v_normalized text;
  v_match_count integer := 0;
begin
  select * into v_catalog
  from public.place_catalog
  where id=p_catalog_id
    and business_status='open'
  for share;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  v_road := coalesce(nullif(btrim(v_catalog.road_address),''), nullif(btrim(v_catalog.address),''));
  v_address := nullif(btrim(v_catalog.address),'');
  v_normalized := lower(regexp_replace(btrim(v_catalog.name),'[[:space:]]+','','g'));

  if char_length(btrim(v_catalog.name)) not between 1 and 100
     or v_road is null
     or char_length(v_road)>300
     or (v_address is not null and char_length(v_address)>300)
     or (v_catalog.branch_name is not null and char_length(btrim(v_catalog.branch_name))>100)
     or (v_catalog.region_1 is not null and char_length(btrim(v_catalog.region_1))>80)
     or (v_catalog.region_2 is not null and char_length(btrim(v_catalog.region_2))>80)
     or ((v_catalog.latitude is null) <> (v_catalog.longitude is null))
     or (v_catalog.latitude is not null and v_catalog.latitude not between -90 and 90)
     or (v_catalog.longitude is not null and v_catalog.longitude not between -180 and 180) then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('place:'||v_catalog.place_provider||':'||v_catalog.provider_place_id,0)
  );

  select * into v_place
  from public.places
  where place_provider=v_catalog.place_provider
    and provider_place_id=v_catalog.provider_place_id
  for update;

  if found then
    if not v_place.is_visible then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;
  else
    -- Provider IDs can change between source revisions. Before creating another
    -- canonical place, reuse one same-provider place only when exact metadata
    -- identifies a single unambiguous candidate. Ambiguous matches remain for
    -- administrator reconciliation instead of silently merging branches.
    select count(*) into v_match_count
    from public.places p
    where p.place_provider=v_catalog.place_provider
      and lower(regexp_replace(btrim(p.name),'[[:space:]]+','','g'))=v_normalized
      and (
        nullif(btrim(p.road_address),'')=v_road
        or (v_address is not null and nullif(btrim(p.address),'')=v_address)
        or (
          v_catalog.latitude is not null
          and p.latitude=v_catalog.latitude
          and p.longitude=v_catalog.longitude
        )
      );

    if v_match_count>1 then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    elsif v_match_count=1 then
      select p.id into v_match_id
      from public.places p
      where p.place_provider=v_catalog.place_provider
        and lower(regexp_replace(btrim(p.name),'[[:space:]]+','','g'))=v_normalized
        and (
          nullif(btrim(p.road_address),'')=v_road
          or (v_address is not null and nullif(btrim(p.address),'')=v_address)
          or (
            v_catalog.latitude is not null
            and p.latitude=v_catalog.latitude
            and p.longitude=v_catalog.longitude
          )
        )
      limit 1;

      select * into v_place from public.places where id=v_match_id for update;
      if not v_place.is_visible then
        raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
      end if;
      update public.places
      set provider_place_id=v_catalog.provider_place_id,
          name=btrim(v_catalog.name),
          branch_name=nullif(btrim(v_catalog.branch_name),''),
          road_address=v_road,
          address=v_address,
          region_1=nullif(btrim(v_catalog.region_1),''),
          region_2=nullif(btrim(v_catalog.region_2),''),
          latitude=v_catalog.latitude,
          longitude=v_catalog.longitude
      where id=v_place.id
      returning * into v_place;
    else
      insert into public.places(
        name,branch_name,road_address,address,region_1,region_2,
        latitude,longitude,place_provider,provider_place_id
      ) values (
        btrim(v_catalog.name),nullif(btrim(v_catalog.branch_name),''),v_road,v_address,
        nullif(btrim(v_catalog.region_1),''),nullif(btrim(v_catalog.region_2),''),
        v_catalog.latitude,v_catalog.longitude,v_catalog.place_provider,v_catalog.provider_place_id
      ) returning * into v_place;
    end if;
  end if;

  if v_place.provider_place_id=v_catalog.provider_place_id then
    update public.places
    set name=btrim(v_catalog.name),
        branch_name=nullif(btrim(v_catalog.branch_name),''),
        road_address=v_road,
        address=v_address,
        region_1=nullif(btrim(v_catalog.region_1),''),
        region_2=nullif(btrim(v_catalog.region_2),''),
        latitude=v_catalog.latitude,
        longitude=v_catalog.longitude
    where id=v_place.id
      and is_visible
    returning * into v_place;
  end if;

  return v_place;
end;
$$;

revoke all on function private.place_from_catalog(uuid) from public, anon, authenticated;

create or replace function private.select_place_catalog_item_impl(
  p_category_id uuid,
  p_catalog_id uuid
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_place public.places%rowtype;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  if not public.category_uses_place_catalog(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_place := private.place_from_catalog(p_catalog_id);

  perform pg_advisory_xact_lock(
    hashtextextended('place-item:'||v_place.id::text||':'||p_category_id::text,0)
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
    if v_item.status not in ('active','discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;

    update public.item_channels
    set is_primary=false
    where item_id=v_item.id
      and channel<>'offline'
      and is_primary;

    insert into public.item_channels(item_id,channel,target_url,is_primary)
    values(v_item.id,'offline',v_place.map_url,true)
    on conflict(item_id,channel) do update
    set target_url=excluded.target_url,
        is_primary=true,
        updated_at=now();

    return v_item;
  end if;

  insert into public.items(
    category_id,name,normalized_name,status,external_source,external_id
  ) values (
    p_category_id,btrim(v_place.name),lower(regexp_replace(btrim(v_place.name),'[[:space:]]+','','g')),
    'active','onepick_place',v_place.id::text||':'||p_category_id::text
  ) returning * into v_item;

  insert into public.item_places(item_id,category_id,place_id)
  values(v_item.id,p_category_id,v_place.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'offline',v_place.map_url,true);

  return v_item;
end;
$$;

revoke all on function private.select_place_catalog_item_impl(uuid,uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared helper: official URL (+ platform identity) → online store + provider
-- (body moved from admin_upsert_online_provider_item_impl).
-- ---------------------------------------------------------------------------
create or replace function private.resolve_online_provider(
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(provider_id uuid, online_store_id uuid, official_url text, provider_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
  v_type text := lower(btrim(coalesce(p_store_type,'')));
  v_url text := btrim(coalesce(p_official_url,''));
  v_host text;
  v_platform text := nullif(lower(btrim(coalesce(p_platform,''))),'');
  v_store_key text;
  v_store public.online_stores%rowtype;
  v_provider public.providers%rowtype;
begin
  if char_length(v_name) not between 1 and 100 then
    raise exception 'PROVIDER_NAME_INVALID' using errcode='P0001';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  v_host := private.online_store_host(v_url);
  v_store_key := private.canonical_online_store_key(
    v_type,v_url,v_platform,p_store_key
  );

  perform pg_advisory_xact_lock(
    hashtextextended('online-store:'||v_store_key,0)
  );

  select * into v_store
  from public.online_stores
  where store_key=v_store_key
  for update;

  if found then
    if v_store.store_type<>v_type
       or v_store.host<>v_host
       or v_store.platform is distinct from v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if v_store.official_url is distinct from v_url then
      update public.online_stores
      set official_url=v_url
      where id=v_store.id
      returning * into v_store;
    end if;
  else
    insert into public.online_stores(
      store_type,host,platform,store_key,official_url
    )
    values(
      v_type,v_host,v_platform,v_store_key,v_url
    )
    returning * into v_store;
  end if;

  select pr.* into v_provider
  from public.providers pr
  where pr.online_store_id=v_store.id
  for update;

  if found then
    if v_provider.kind<>'online_store' then
      raise exception 'PROVIDER_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if p_brand_id is not null
       and v_provider.brand_id is not null
       and v_provider.brand_id<>p_brand_id
    then
      raise exception 'PROVIDER_BRAND_CONFLICT' using errcode='P0001';
    end if;

    update public.providers
    set name=v_name,
        brand_id=coalesce(v_provider.brand_id,p_brand_id)
    where id=v_provider.id
    returning * into v_provider;
  else
    insert into public.providers(
      kind,name,brand_id,online_store_id,status,created_by
    )
    values(
      'online_store',v_name,p_brand_id,v_store.id,'active',v_actor
    )
    returning * into v_provider;
  end if;

  provider_id := v_provider.id;
  online_store_id := v_store.id;
  official_url := v_url;
  provider_name := v_name;
  return next;
end;
$$;

revoke all on function private.resolve_online_provider(text,text,text,text,text,uuid)
  from public, anon, authenticated;

create or replace function private.admin_upsert_online_provider_item_impl(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_resolved record;
  v_item public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
  then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_resolved
  from private.resolve_online_provider(p_name,p_store_type,p_official_url,p_platform,p_store_key,p_brand_id);

  perform pg_advisory_xact_lock(
    hashtextextended(
      'provider-item:'||v_resolved.provider_id::text||':'||p_category_id::text,
      0
    )
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id=ipr.item_id
  where ipr.provider_id=v_resolved.provider_id
    and ipr.category_id=p_category_id
  for update of i;

  if not found then
    insert into public.items(
      category_id,brand_id,name,normalized_name,status,
      external_source,external_id,created_by
    )
    values(
      p_category_id,null,v_resolved.provider_name,
      lower(regexp_replace(v_resolved.provider_name,'[[:space:]]','','g')),'active',
      'onepick_provider',v_resolved.provider_id::text||':'||p_category_id::text,v_actor
    )
    returning * into v_item;

    insert into public.item_providers(item_id,category_id,provider_id)
    values(v_item.id,p_category_id,v_resolved.provider_id);
  end if;

  -- Existing provider items keep their item identity but follow the provider's
  -- current display name and official URL.
  if v_item.name is distinct from v_resolved.provider_name then
    update public.items
    set name=v_resolved.provider_name,
        normalized_name=lower(regexp_replace(v_resolved.provider_name,'[[:space:]]','','g'))
    where id=v_item.id
    returning * into v_item;
  end if;

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_resolved.official_url,true)
  on conflict on constraint item_channels_pkey do update
  set target_url=excluded.target_url,
      is_primary=true,
      updated_at=now();

  provider_id := v_resolved.provider_id;
  online_store_id := v_resolved.online_store_id;
  item_id := v_item.id;
  category_id := p_category_id;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: list channel-less items under a root (default food)
-- ---------------------------------------------------------------------------
create or replace function public.admin_unlinked_items(
  p_root_slug text default 'food',
  p_query text default null,
  p_limit integer default 50
)
returns table(
  item_id uuid, item_name text, category_id uuid, category_name text,
  category_path text, uses_place_catalog boolean, pick_count bigint, created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := nullif(lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g')),'');
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  return query
  select i.id, i.name, c.id, c.name,
    concat_ws(' › ', gp.name, parent.name, c.name),
    public.category_uses_place_catalog(c.id),
    (select count(*) from public.picks p where p.item_id=i.id and p.status='active'),
    i.created_at
  from public.items i
  join public.categories c on c.id=i.category_id
  left join public.categories parent on parent.id=c.parent_id
  left join public.categories gp on gp.id=parent.parent_id
  where i.status in ('active','discontinued')
    and i.external_source is null
    and not exists (select 1 from public.item_channels ch where ch.item_id=i.id)
    and not exists (select 1 from public.item_providers ipr where ipr.item_id=i.id)
    and (p_root_slug is null or coalesce(gp.slug, parent.slug, c.slug)=p_root_slug)
    and (v_query is null or lower(regexp_replace(i.name,'[[:space:]]+','','g')) like '%'||v_query||'%')
  order by 7 desc, i.created_at desc
  limit least(greatest(coalesce(p_limit,50),1),100);
end;
$$;

revoke all on function public.admin_unlinked_items(text,text,integer) from public, anon;
grant execute on function public.admin_unlinked_items(text,text,integer) to authenticated;

-- Shared guard for both link actions.
create or replace function private.lock_linkable_item(p_item_id uuid)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  select * into v_item from public.items where id=p_item_id for update;
  if not found or v_item.status not in ('active','discontinued') then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;
  if v_item.external_source is not null
     or exists (select 1 from public.item_providers where item_id=v_item.id)
     or exists (select 1 from public.item_places where item_id=v_item.id)
     or exists (select 1 from public.item_channels where item_id=v_item.id)
  then
    raise exception 'ITEM_ALREADY_LINKED' using errcode='P0001';
  end if;
  if v_item.brand_id is not null then
    -- Provider-backed items inherit their brand through the provider.
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='P0001';
  end if;
  return v_item;
end;
$$;

revoke all on function private.lock_linkable_item(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin: existing item → 매장 (place)
-- ---------------------------------------------------------------------------
create or replace function private.admin_link_item_to_place_impl(p_item_id uuid, p_catalog_id uuid)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_place public.places%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  v_item := private.lock_linkable_item(p_item_id);

  if not public.category_uses_place_catalog(v_item.category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_place := private.place_from_catalog(p_catalog_id);

  perform pg_advisory_xact_lock(
    hashtextextended('place-item:'||v_place.id::text||':'||v_item.category_id::text,0)
  );

  if exists (
    select 1 from public.item_places
    where place_id=v_place.id and category_id=v_item.category_id
  ) then
    -- The place already has its canonical item in this category.
    raise exception 'PLACE_ALREADY_LINKED' using errcode='P0001';
  end if;

  update public.items
  set external_source='onepick_place',
      external_id=v_place.id::text||':'||v_item.category_id::text
  where id=v_item.id
  returning * into v_item;

  -- item_places_sync_provider attaches the place's offline provider.
  insert into public.item_places(item_id,category_id,place_id)
  values(v_item.id,v_item.category_id,v_place.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'offline',v_place.map_url,true);

  return v_item;
end;
$$;

revoke all on function private.admin_link_item_to_place_impl(uuid,uuid) from public, anon, authenticated;

create or replace function public.admin_link_item_to_place(p_item_id uuid, p_catalog_id uuid)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  return private.admin_link_item_to_place_impl(p_item_id,p_catalog_id);
end;
$$;

revoke all on function public.admin_link_item_to_place(uuid,uuid) from public, anon;
grant execute on function public.admin_link_item_to_place(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: existing item → 온라인 (online store)
-- ---------------------------------------------------------------------------
create or replace function private.admin_link_item_to_online_provider_impl(
  p_item_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_resolved record;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  v_item := private.lock_linkable_item(p_item_id);

  if not public.category_is_open_leaf(v_item.category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_resolved
  from private.resolve_online_provider(p_name,p_store_type,p_official_url,p_platform,p_store_key,null);

  perform pg_advisory_xact_lock(
    hashtextextended(
      'provider-item:'||v_resolved.provider_id::text||':'||v_item.category_id::text,
      0
    )
  );

  if exists (
    select 1 from public.item_providers
    where provider_id=v_resolved.provider_id and category_id=v_item.category_id
  ) then
    -- The store already has its canonical item in this category.
    raise exception 'PROVIDER_ALREADY_LINKED' using errcode='P0001';
  end if;

  update public.items
  set external_source='onepick_provider',
      external_id=v_resolved.provider_id::text||':'||v_item.category_id::text
  where id=v_item.id
  returning * into v_item;

  insert into public.item_providers(item_id,category_id,provider_id)
  values(v_item.id,v_item.category_id,v_resolved.provider_id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_resolved.official_url,true);

  return v_item;
end;
$$;

revoke all on function private.admin_link_item_to_online_provider_impl(uuid,text,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.admin_link_item_to_online_provider(
  p_item_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  return private.admin_link_item_to_online_provider_impl(
    p_item_id,p_name,p_store_type,p_official_url,p_platform,p_store_key
  );
end;
$$;

revoke all on function public.admin_link_item_to_online_provider(uuid,text,text,text,text,text)
  from public, anon;
grant execute on function public.admin_link_item_to_online_provider(uuid,text,text,text,text,text)
  to authenticated;

commit;
