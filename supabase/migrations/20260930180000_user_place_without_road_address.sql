-- 새 매장 직접 등록에서 도로명 주소를 받지 않는다 (user decision 2026-09-30, #593).
--
-- A store the catalog search did not find is registered with its name and
-- Naver map link only.
--   * stage_user_place_item keeps its signature and grants; p_road_address is a
--     legacy, optional input. The app sends ''. A sent address is still kept.
--   * places.road_address stays NOT NULL; only a member-submitted place
--     (place_provider = 'user') may hold ''. Catalog rows keep null.
--   * A member-submitted store is reused on normalized name + the exact map link
--     (was: + road address). The link is not expanded, so a different short link
--     to the same store is a second pending request. That is deliberate: a wrong
--     merge of two branches is worse than a duplicate. admin_merge_pending_item
--     refuses provider-linked items, so review approves one and rejects the rest.
--   * place_from_catalog lets an approved address-less member store be picked
--     from search. Catalog-imported places still need an address.
--   * revise_item_request refuses a new map link that would give a member store
--     the same name + link as another one (PLACE_ALREADY_REGISTERED).

begin;

alter table public.places
  drop constraint places_road_address_length,
  add constraint places_road_address_length
    check (
      char_length(btrim(road_address)) between 1 and 300
      or (place_provider = 'user' and road_address = '')
    );

create or replace function private.stage_user_place_item_impl(
  p_category_id uuid,
  p_name text,
  p_branch_name text,
  p_road_address text,
  p_map_url text
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  -- Legacy input: the app no longer asks for it; stored as '' when absent.
  v_road text := btrim(coalesce(p_road_address, ''));
  v_map text := btrim(coalesce(p_map_url, ''));
  v_normalized text;
  v_place public.places%rowtype;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;
  if not public.category_uses_place_catalog(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 1 and 100
     or (v_branch is not null and char_length(v_branch) > 100) then
    raise exception 'PLACE_NAME_INVALID' using errcode = 'P0001';
  end if;
  if char_length(v_road) > 300 then
    raise exception 'PLACE_ADDRESS_INVALID' using errcode = 'P0001';
  end if;
  -- Without a catalog match the map link is the store's identity (decision 73).
  if v_map = '' then
    raise exception 'ITEM_LINK_REQUIRED' using errcode = 'P0001';
  end if;
  if not private.is_naver_map_url(v_map) then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  v_normalized := lower(regexp_replace(v_name, '[[:space:]]+', '', 'g'));

  perform pg_advisory_xact_lock(
    hashtextextended('user-place:' || v_normalized || ':' || v_map, 0)
  );

  -- The same normalized name with the exact same map link is the same store.
  -- The link is not expanded (no external lookup), so another short link to the
  -- same store makes a second pending request; review resolves duplicates.
  select * into v_place
  from public.places p
  where p.place_provider = 'user'
    and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_normalized
    and p.map_url = v_map
  order by p.created_at
  limit 1
  for update;

  if not found then
    if (
      select count(*) from public.items
      where created_by = v_user and created_at > now() - interval '1 day'
    ) >= 20 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;

    insert into public.places(
      name, branch_name, road_address, place_provider, provider_place_id, map_url, is_visible
    ) values (
      v_name, v_branch, v_road, 'user', gen_random_uuid()::text, v_map, false
    ) returning * into v_place;

    insert into public.place_catalog(
      place_provider, provider_place_id, name, normalized_name, branch_name,
      road_address, business_status, source_updated_at
    ) values (
      v_place.place_provider, v_place.provider_place_id, v_name,
      private.normalize_place_name(v_name), v_branch, nullif(v_road, ''), 'pending', now()
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('place-item:' || v_place.id::text || ':' || p_category_id::text, 0)
  );

  select i.* into v_item
  from public.item_places ip
  join public.items i on i.id = ip.item_id and i.category_id = ip.category_id
  where ip.place_id = v_place.id
    and ip.category_id = p_category_id
  for update of i;

  if found then
    if v_item.status = 'pending' then
      if v_item.created_by is distinct from v_user then
        raise exception 'ITEM_ALREADY_PENDING' using errcode = 'P0001';
      end if;
      return v_item;
    end if;
    if v_item.status not in ('active', 'discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
    return v_item;
  end if;

  if (
    select count(*) from public.items
    where created_by = v_user and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.items(
    category_id, name, normalized_name, status, created_by, external_source, external_id
  ) values (
    p_category_id, v_name, v_normalized, 'pending', v_user,
    'onepick_place', v_place.id::text || ':' || p_category_id::text
  ) returning * into v_item;

  insert into public.item_places(item_id, category_id, place_id)
  values (v_item.id, p_category_id, v_place.id);

  insert into public.item_channels(item_id, channel, target_url, is_primary)
  values (v_item.id, 'offline', v_place.map_url, true);

  return v_item;
end;
$$;

-- Same as 20260926190000 except that an address-less member store is allowed.
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
  -- A member-submitted store may have no address (#593); its place keeps ''.
  if v_road is null and v_catalog.place_provider = 'user' then
    v_road := '';
  end if;

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

-- A revised map link on a member-submitted store keeps the name + link identity
-- unique (same as 20260928210000 otherwise).
create or replace function private.revise_item_request_impl(
  p_item_id uuid,
  p_link_url text,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text,
  p_remove_photo boolean
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.items%rowtype;
  v_link text := btrim(p_link_url);
  v_channel text;
  v_place public.places%rowtype;
  v_normalized text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.created_by is distinct from v_user or v_item.status not in ('pending', 'rejected') then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_link is not null and v_link <> '' then
    select ch.channel into v_channel
    from public.item_channels ch
    where ch.item_id = v_item.id
    order by ch.is_primary desc, ch.channel
    limit 1;
    if v_channel is null then
      raise exception 'ITEM_LINK_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if (v_channel = 'offline' and not private.is_naver_map_url(v_link))
       or (v_channel <> 'offline' and not private.is_https_link(v_link)) then
      raise exception 'LINK_INVALID' using errcode = 'P0001';
    end if;
    -- A member-submitted store is identified by normalized name + exact map link
    -- (#593). A revised link must not collide with another such store; never
    -- merge automatically.
    if v_channel = 'offline' then
      select p.* into v_place
      from public.item_places ip
      join public.places p on p.id = ip.place_id
      where ip.item_id = v_item.id and p.place_provider = 'user'
      for update of p;
      if found and v_place.map_url is distinct from v_link then
        v_normalized := lower(regexp_replace(btrim(v_place.name), '[[:space:]]+', '', 'g'));
        perform pg_advisory_xact_lock(
          hashtextextended('user-place:' || v_normalized || ':' || v_link, 0)
        );
        if exists (
          select 1 from public.places p
          where p.place_provider = 'user'
            and p.id <> v_place.id
            and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_normalized
            and p.map_url = v_link
        ) then
          raise exception 'PLACE_ALREADY_REGISTERED' using errcode = 'P0001';
        end if;
      end if;
    end if;
    update public.item_channels
    set target_url = v_link, updated_at = now()
    where item_id = v_item.id and channel = v_channel;
    if v_channel = 'offline' then
      update public.places p
      set map_url = v_link, updated_at = now()
      from public.item_places ip
      where ip.item_id = v_item.id and p.id = ip.place_id and p.place_provider = 'user';
    end if;
  end if;

  if p_remove_photo then
    update public.items
    set image_path = null, thumbnail_path = null, image_source_url = null
    where id = v_item.id;
  elsif p_image_path is not null or p_thumbnail_path is not null then
    perform private.assert_item_photo_owned(v_user, p_image_path, p_thumbnail_path, p_image_source_url);
    update public.items
    set image_path = p_image_path,
        thumbnail_path = p_thumbnail_path,
        image_source_url = p_image_source_url
    where id = v_item.id;
  end if;

  update public.items
  set status = 'pending', merged_into_item_id = null
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

comment on function public.stage_user_place_item(uuid, text, text, text, text) is
  'A store the catalog search did not find: name + Naver map link (road address is a legacy optional input) make the caller''s pending store × menu request (hidden until approval), reused on name + exact map link. Pick it with register_item_pick(p_item_id).';

commit;
