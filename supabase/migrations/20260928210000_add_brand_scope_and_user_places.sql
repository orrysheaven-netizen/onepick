-- 브랜드 전체 / 지점 범위와 브랜드 프로필 (#448 서버 인계 3번, user decisions 2026-09-28).
--
-- Decisions this migration implements (Figma 70/71, 73):
--   * "브랜드 전체" and a specific branch are separate product scopes. A brand-wide
--     product is brand × menu (item_brand_scopes); a branch product stays
--     place × menu (item_places). Picks, counts and comment eligibility are per
--     product, so nothing is summed up to the brand.
--   * The brand profile lists every branch (and seller) of the brand that holds
--     at least one current Pick, paged, and shows the brand-wide products in a
--     separate section only while they hold Picks.
--   * A store the catalog does not know can still be registered: the member
--     names it and gives its Naver map link and road address. It is their
--     pending request (hidden place, hidden catalog row) until approval, after
--     which it is searchable and selectable like a catalog place.
--
-- Registration goes through register_item_pick(p_item_id => <staged item>)
-- after stage_brand_item / stage_user_place_item; existing catalog and seller
-- paths are unchanged. External links (map, official site) belong to the
-- provider profile; item rows keep only their own channel links.

begin;

-- ---------------------------------------------------------------------------
-- Brand-wide products
-- ---------------------------------------------------------------------------

create table public.item_brand_scopes (
  item_id uuid primary key,
  category_id uuid not null,
  brand_id uuid not null references public.brands(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint item_brand_scopes_item_category_fk foreign key (item_id, category_id)
    references public.items(id, category_id) on delete cascade,
  unique (brand_id, category_id)
);
comment on table public.item_brand_scopes is
  'A product that stands for a whole brand under one menu (브랜드 전체), separate from its branches.';

alter table public.item_brand_scopes enable row level security;
revoke all on public.item_brand_scopes from public, anon, authenticated;
grant select on public.item_brand_scopes to anon, authenticated;
grant all on public.item_brand_scopes to service_role;

create policy item_brand_scopes_anon_read on public.item_brand_scopes
for select to anon
using (
  exists (
    select 1
    from public.items i
    join public.brands b on b.id = item_brand_scopes.brand_id
    where i.id = item_brand_scopes.item_id
      and i.category_id = item_brand_scopes.category_id
      and i.status in ('active', 'discontinued')
      and b.is_active
  )
);

create policy item_brand_scopes_authenticated_read on public.item_brand_scopes
for select to authenticated
using (
  (select private.is_admin_mfa())
  or exists (
    select 1
    from public.items i
    join public.brands b on b.id = item_brand_scopes.brand_id
    where i.id = item_brand_scopes.item_id
      and i.category_id = item_brand_scopes.category_id
      and (
        (i.status in ('active', 'discontinued') and b.is_active)
        or i.created_by = (select auth.uid())
      )
  )
);

-- Brand-wide products can be picked while the brand is active. Same as
-- 20260924231500 for provider-backed and other items.
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
      when exists (select 1 from public.item_brand_scopes s where s.item_id=p_item_id) then exists (
        select 1
        from public.item_brand_scopes s
        join public.brands b on b.id=s.brand_id
        where s.item_id=p_item_id
          and b.is_active
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

-- Card reads: a brand-wide product carries its brand like a provider does.
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
  left join public.item_brand_scopes s on s.item_id=i.id
  join public.brands b on b.id=coalesce(pr.brand_id, s.brand_id, i.brand_id)
  where i.id = any(p_item_ids[1:100]);
$$;

create or replace function private.stage_brand_item_impl(
  p_category_id uuid,
  p_brand_id uuid
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_brand public.brands%rowtype;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;
  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
     or not private.category_is_food(p_category_id)
     or not exists (select 1 from public.categories c where c.id = p_category_id and c.is_visible and c.is_pickable) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;

  select * into v_brand from public.brands where id = p_brand_id;
  if not found or not v_brand.is_active then
    raise exception 'BRAND_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('brand-item:' || v_brand.id::text || ':' || p_category_id::text, 0)
  );

  select i.* into v_item
  from public.item_brand_scopes s
  join public.items i on i.id = s.item_id
  where s.brand_id = v_brand.id
    and s.category_id = p_category_id
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
    category_id, brand_id, name, normalized_name, status,
    external_source, external_id, created_by
  ) values (
    p_category_id, v_brand.id, v_brand.name,
    lower(regexp_replace(v_brand.name, '[[:space:]]', '', 'g')), 'pending',
    'onepick_brand', v_brand.id::text || ':' || p_category_id::text, v_user
  ) returning * into v_item;

  insert into public.item_brand_scopes(item_id, category_id, brand_id)
  values (v_item.id, p_category_id, v_brand.id);

  -- A brand-wide product is picked as a place to eat, like its branches.
  insert into public.item_channels(item_id, channel, target_url, is_primary)
  values (v_item.id, 'offline', null, true);

  return v_item;
end;
$$;

create or replace function public.stage_brand_item(
  p_category_id uuid,
  p_brand_id uuid
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.stage_brand_item_impl(p_category_id, p_brand_id);
$$;

revoke all on function private.stage_brand_item_impl(uuid, uuid) from public, anon;
grant execute on function private.stage_brand_item_impl(uuid, uuid) to authenticated, service_role;
revoke all on function public.stage_brand_item(uuid, uuid) from public, anon;
grant execute on function public.stage_brand_item(uuid, uuid) to authenticated, service_role;
comment on function public.stage_brand_item(uuid, uuid) is
  'The brand-wide product (브랜드 전체) for a brand and menu: the existing one, or a new pending request of the caller. Pick it with register_item_pick(p_item_id).';

-- ---------------------------------------------------------------------------
-- Stores the catalog does not know
-- ---------------------------------------------------------------------------

-- A member-submitted store waits in the catalog as 'pending': not searchable,
-- its place hidden, until the product request is approved.
alter table public.place_catalog
  drop constraint place_catalog_business_status_check,
  add constraint place_catalog_business_status_check
    check (business_status in ('open', 'closed', 'pending')),
  drop constraint place_catalog_closed_at,
  add constraint place_catalog_closed_at
    check (
      (business_status = 'closed' and closed_at is not null)
      or (business_status in ('open', 'pending') and closed_at is null)
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
  if char_length(v_road) not between 1 and 300 then
    raise exception 'PLACE_ADDRESS_REQUIRED' using errcode = 'P0001';
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
    hashtextextended('user-place:' || v_normalized || ':' || lower(v_road), 0)
  );

  -- The same name at the same road address is the same store.
  select * into v_place
  from public.places p
  where p.place_provider = 'user'
    and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_normalized
    and lower(btrim(p.road_address)) = lower(v_road)
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
      private.normalize_place_name(v_name), v_branch, v_road, 'pending', now()
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

create or replace function public.stage_user_place_item(
  p_category_id uuid,
  p_name text,
  p_road_address text,
  p_map_url text,
  p_branch_name text default null
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.stage_user_place_item_impl(p_category_id, p_name, p_branch_name, p_road_address, p_map_url);
$$;

revoke all on function private.stage_user_place_item_impl(uuid, text, text, text, text) from public, anon;
grant execute on function private.stage_user_place_item_impl(uuid, text, text, text, text) to authenticated, service_role;
revoke all on function public.stage_user_place_item(uuid, text, text, text, text) from public, anon;
grant execute on function public.stage_user_place_item(uuid, text, text, text, text) to authenticated, service_role;
comment on function public.stage_user_place_item(uuid, text, text, text, text) is
  'A store the catalog search did not find: name + road address + Naver map link make the caller''s pending store × menu request (hidden until approval). Pick it with register_item_pick(p_item_id).';

-- Approval publishes a member-submitted store: the place becomes visible and
-- the catalog row opens for search. Runs before items_notify_requester_on_review
-- (trigger name order) so the waiting Pick can activate against a visible place.
create or replace function private.activate_user_place_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place public.places%rowtype;
begin
  if old.status <> 'pending' or new.status <> 'active' then
    return new;
  end if;
  select p.* into v_place
  from public.item_places ip
  join public.places p on p.id = ip.place_id
  where ip.item_id = new.id and p.place_provider = 'user';
  if not found then
    return new;
  end if;
  update public.places set is_visible = true, updated_at = now()
  where id = v_place.id and not is_visible;
  update public.place_catalog
  set business_status = 'open', source_updated_at = now(), updated_at = now()
  where place_provider = v_place.place_provider
    and provider_place_id = v_place.provider_place_id
    and business_status = 'pending';
  return new;
end;
$$;
revoke all on function private.activate_user_place_on_approval() from public, anon, authenticated;

create trigger items_activate_user_place
after update of status on public.items
for each row execute function private.activate_user_place_on_approval();

-- A revised map link on a member-submitted store updates the place too
-- (same as 20260928190000 otherwise).
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

-- ---------------------------------------------------------------------------
-- Brand profile
-- ---------------------------------------------------------------------------

-- People currently holding a Pick on one product (any channel), suspended
-- members left out, as the rankings count.
create or replace function private.item_pick_people(p_item_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct p.user_id)
  from public.picks p
  where p.item_id = p_item_id
    and p.status = 'active'
    and not private.user_is_suspended(p.user_id);
$$;
revoke all on function private.item_pick_people(uuid) from public, anon, authenticated;

-- The brand, its brand-wide products that hold Picks (hidden when none) and
-- how many of its providers hold Picks. Null for an unknown or inactive brand.
create or replace function public.brand_profile(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_brand public.brands%rowtype;
  v_wide jsonb;
  v_branches bigint;
begin
  select * into v_brand from public.brands where id = p_brand_id and is_active;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', x.item_id,
      'category_id', x.category_id,
      'category_name', x.category_name,
      'pick_count', x.pick_count
    ) order by x.pick_count desc, x.category_name), '[]'::jsonb)
  into v_wide
  from (
    select i.id as item_id, c.id as category_id, c.name as category_name,
           private.item_pick_people(i.id) as pick_count
    from public.item_brand_scopes s
    join public.items i on i.id = s.item_id and i.status in ('active', 'discontinued')
    join public.categories c on c.id = s.category_id
    where s.brand_id = v_brand.id
  ) x
  where x.pick_count > 0;

  select count(*) into v_branches
  from public.providers pr
  left join public.places pl on pl.id = pr.place_id
  where pr.brand_id = v_brand.id
    and pr.status = 'active'
    and (pr.kind = 'online_store' or pl.is_visible)
    and exists (
      select 1
      from public.item_providers ip
      join public.items i on i.id = ip.item_id and i.status in ('active', 'discontinued')
      join public.picks p on p.item_id = i.id and p.status = 'active'
      where ip.provider_id = pr.id
        and not private.user_is_suspended(p.user_id)
    );

  return jsonb_build_object(
    'brand', jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'logo_path', v_brand.logo_path),
    'brand_wide', v_wide,
    'branch_count', v_branches
  );
end;
$$;
revoke all on function public.brand_profile(uuid) from public;
grant execute on function public.brand_profile(uuid) to anon, authenticated, service_role;
comment on function public.brand_profile(uuid) is
  'Brand profile header: the brand, its brand-wide products that currently hold Picks (empty when none) and how many of its branches/sellers hold Picks. Counts are per product, never summed.';

-- Branches and sellers of a brand that hold at least one current Pick, most
-- picked first, keyset-paged by (pick_count, provider_id).
create or replace function public.brand_branch_page(
  p_brand_id uuid,
  p_after_pick_count bigint default null,
  p_after_provider_id uuid default null,
  p_limit integer default 20
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (p_after_pick_count is null) <> (p_after_provider_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  if not exists (select 1 from public.brands b where b.id = p_brand_id and b.is_active) then
    return;
  end if;

  return query
  select jsonb_build_object(
      'provider_id', x.provider_id,
      'kind', x.kind,
      'name', x.name,
      'branch_name', x.branch_name,
      'region_1', x.region_1,
      'region_2', x.region_2,
      'road_address', x.road_address,
      'map_url', x.map_url,
      'official_url', x.official_url,
      'pick_count', x.pick_count,
      'menu_count', x.menu_count
    )
  from (
    select pr.id as provider_id, pr.kind, pr.name, pr.branch_name,
           pl.region_1, pl.region_2, pl.road_address, pl.map_url, os.official_url,
           (
             select count(distinct p.user_id)
             from public.item_providers ip
             join public.items i on i.id = ip.item_id and i.status in ('active', 'discontinued')
             join public.picks p on p.item_id = i.id and p.status = 'active'
             where ip.provider_id = pr.id
               and not private.user_is_suspended(p.user_id)
           ) as pick_count,
           (
             select count(distinct ip.category_id)
             from public.item_providers ip
             join public.items i on i.id = ip.item_id and i.status in ('active', 'discontinued')
             where ip.provider_id = pr.id
               and exists (
                 select 1 from public.picks p
                 where p.item_id = i.id and p.status = 'active'
                   and not private.user_is_suspended(p.user_id)
               )
           ) as menu_count
    from public.providers pr
    left join public.places pl on pl.id = pr.place_id
    left join public.online_stores os on os.id = pr.online_store_id
    where pr.brand_id = p_brand_id
      and pr.status = 'active'
      and (pr.kind = 'online_store' or pl.is_visible)
  ) x
  where x.pick_count > 0
    and (p_after_provider_id is null or (x.pick_count, x.provider_id) < (p_after_pick_count, p_after_provider_id))
  order by x.pick_count desc, x.provider_id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke all on function public.brand_branch_page(uuid, bigint, uuid, integer) from public;
grant execute on function public.brand_branch_page(uuid, bigint, uuid, integer) to anon, authenticated, service_role;
comment on function public.brand_branch_page(uuid, bigint, uuid, integer) is
  'Branches and sellers of a brand that hold at least one current Pick (one or two people included), most picked first, keyset-paged by (pick_count, provider_id). Each row is its own product scope; map_url / official_url are the external links shown on the provider profile.';

-- ---------------------------------------------------------------------------
-- Review: identity-backed products are not name duplicates
-- ---------------------------------------------------------------------------

-- A brand-wide product carries its brand's name, and a seller × menu product
-- (stage_online_provider_item) its seller's name, exactly as branches carry the
-- store's name. Their identity is brand × menu / provider × menu / place × menu,
-- so approval keeps the name and category and skips the duplicate-name check
-- that name-only requests need. Same as 20260927213947 otherwise.
create or replace function private.admin_review_pending_item_impl(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null,
  p_reject_reason text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
  v_reason text;
  v_identity_backed boolean;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found or v_item.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  if p_status='rejected' then
    v_reason := btrim(p_reject_reason);
    if v_reason is null or char_length(v_reason) not between 1 and 500 then
      raise exception 'REJECT_REASON_INVALID' using errcode='P0001';
    end if;

    update public.items
    set status='rejected', merged_into_item_id=null
    where id=v_item.id
    returning * into v_item;

    insert into private.item_review_log(item_id,status,rejection_reason,reviewed_by)
    values (v_item.id,'rejected',v_reason,auth.uid());

    if v_item.created_by is not null then
      insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, reason)
      values (v_item.id, v_item.created_by, 'rejected', v_item.id, v_reason)
      on conflict (item_id, recipient_id) do update
        set outcome = excluded.outcome,
            target_item_id = excluded.target_item_id,
            pick_id = null,
            reason = excluded.reason,
            created_at = now(),
            read_at = null;
    end if;
    return v_item;
  end if;

  if p_status<>'active' then
    raise exception 'ITEM_STATUS_INVALID' using errcode='P0001';
  end if;

  select * into v_category
  from public.categories
  where id=coalesce(p_category_id,v_item.category_id);

  if not found
     or v_category.slug='pending-product'
     or not public.category_is_open_leaf(v_category.id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_identity_backed :=
    exists(select 1 from public.item_places where item_id=v_item.id)
    or exists(select 1 from public.item_providers where item_id=v_item.id)
    or exists(select 1 from public.item_brand_scopes where item_id=v_item.id);

  if v_identity_backed then
    -- The (place | provider | brand) + category pair is the identity; reject
    -- it instead of moving it.
    if v_category.id<>v_item.category_id then
      raise exception 'PLACE_ITEM_CATEGORY_LOCKED' using errcode='P0001';
    end if;
    v_name := v_item.name;
    v_normalized := v_item.normalized_name;
  else
    v_name := private.canonical_item_name(v_item.name,v_category.slug);
    if v_name is null or char_length(v_name) not between 1 and 100 then
      raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
    end if;
    v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

    if exists (
      select 1 from public.items i
      where i.id<>v_item.id
        and i.category_id=v_category.id
        and i.normalized_name=v_normalized
        and i.status in ('active','discontinued')
    ) then
      raise exception 'ITEM_DUPLICATE' using errcode='P0001';
    end if;
  end if;

  update public.items
  set category_id=v_category.id,
      name=v_name,
      normalized_name=v_normalized,
      status='active',
      merged_into_item_id=null
  where id=v_item.id
  returning * into v_item;

  insert into private.item_review_log(item_id,status,reviewed_by)
  values (v_item.id,'active',auth.uid());
  return v_item;
end;
$$;

-- A brand-wide request is identified by its brand, like a provider item: it
-- is approved or rejected, never merged into another product.
-- Same as 20260928190000 otherwise.
create or replace function public.admin_merge_pending_item(
  p_source_item_id uuid,
  p_target_item_id uuid
)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v_source public.items%rowtype;
  v_target public.items%rowtype;
  v_source_category_slug text;
  v_result public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_source_item_id is null
     or p_target_item_id is null
     or p_source_item_id=p_target_item_id then
    raise exception 'MERGE_TARGET_INVALID' using errcode='P0001';
  end if;

  select * into v_source
  from public.items
  where id=p_source_item_id
  for update;

  if not found or v_source.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  if exists(select 1 from public.item_providers where item_id=v_source.id)
     or exists(select 1 from public.item_brand_scopes where item_id=v_source.id) then
    raise exception 'SOURCE_PROVIDER_ITEM_NOT_MERGEABLE' using errcode='P0001';
  end if;

  select * into v_target
  from public.items
  where id=p_target_item_id
  for update;

  if not found or v_target.status not in ('active','discontinued') then
    raise exception 'TARGET_ITEM_INVALID' using errcode='P0001';
  end if;

  if v_source.category_id<>v_target.category_id then
    select slug into v_source_category_slug
    from public.categories
    where id=v_source.category_id;

    if v_source_category_slug is distinct from 'pending-product' then
      raise exception 'MERGE_CATEGORY_MISMATCH' using errcode='P0001';
    end if;
  end if;

  if exists(
    select 1 from public.picks
    where item_id=v_source.id and status<>'needs_review'
  ) then
    raise exception 'SOURCE_ITEM_IN_USE' using errcode='P0001';
  end if;

  update public.items
  set status='merged',
      merged_into_item_id=v_target.id
  where id=v_source.id
  returning * into v_result;

  return v_result;
end;
$$;

commit;
